# Porting guide

How to re-derive this patch against a new OpenClaw / Feishu-plugin release.

## 1. Locate the target

```
<plugin-root>/dist/.setup/monitor.account-*.mjs
```

`<plugin-root>` is under `~/.openclaw/npm/projects/*/node_modules/@openclaw/feishu`.
The `monitor.account-*.mjs` filename includes a build-specific suffix that **changes
between releases** — never hardcode it. Find it:

```bash
find ~/.openclaw/npm/projects -path '*@openclaw/feishu/dist/.setup/monitor.account-*.mjs'
```

Note: it is a **minified bundle**. Anchor strings are valid across an entire file only if
they are distinctive. Every anchor below is asserted to occur exactly once.

## 2. Record the pristine hash

```bash
sha256sum <target>
```

Back the file up before touching it:

```bash
mkdir -p ~/.openclaw/patches/<timestamp>
cp -p <target> ~/.openclaw/patches/<timestamp>/original.mjs
```

## 3. The 7 anchors

Anchors are given as *concept* plus the exact string used for the 9.8 port. Re-derive
them by searching the new bundle for the surrounding logic — the surrounding code moves
between releases even when the intent does not.

> **Before re-deriving anything, try the previous release's patch.**
> ```bash
> patch --dry-run -p0 pristine.mjs < patches/feishu-tool-aggregation-<prev>.patch
> ```
> On 2026.9.9 the 9.8 patch applied 7/7 with only line-offset drift. When that happens
> the port is a hash update, not a re-derivation — but still confirm the predicate is
> byte-identical (see §4) before trusting the result.

### Edit 1 — reply-scoped state

Add the aggregation state next to the other per-reply text accumulators.

9.8 anchor:

```
	let reasoningText = "";
	let statusLine = "";
	let snapshotBaseText = "";
```

→

```
	let reasoningText = "";
	let statusLine = "";
	const aggregatedToolSummaryCounts = /* @__PURE__ */ new Map();
	let aggregatedToolSummaryLine = "";
	let snapshotBaseText = "";
```

### Edit 2 — render the line above reasoning/answer

The aggregate line has nowhere to live except the streamed card text, so it must be
prepended by whatever composes that text.

9.8 anchor (`buildCombinedStreamText`):

```js
	const buildCombinedStreamText = (thinking, answer) => {
		const parts = [];
		if (thinking) parts.push(formatReasoningPrefix(thinking));
		if (thinking && answer) parts.push("\n\n---\n\n");
		if (answer) parts.push(answer);
```

→ insert the aggregate line first, then make the `---` separators conditional on
`parts.length > 0` so a leading aggregate line without reasoning does not emit a
stray separator.

### Edit 3 — clear on streaming reset

9.8 anchor:

```
		reasoningText = "";
		statusLine = "";
		snapshotBaseText = "";
```

→ insert `aggregatedToolSummaryCounts.clear();` and
`aggregatedToolSummaryLine = "";`.

### Edit 4 — clear when a new reply begins

9.8 anchor:

```
				visibleReplySent = false;
				replyOutcome = void 0;
			}
```

→ insert the same two clear statements.

Without edits 3 and 4, counts leak across replies and the count keeps climbing.

### Edit 5 — insert the predicate and aggregator

Insert immediately **before** `sendChunkedTextReply`.

```js
	const parseCollapsibleToolSummary = (payload, info) => {
		if (info?.kind !== "tool" || payload.isError === true) return void 0;
		if (payload.mediaUrl || payload.mediaUrlFull || payload.mediaUrls?.length || payload.audioAsVoice === true) return void 0;
		if (payload.channelData && Object.keys(payload.channelData).length > 0) return void 0;
		if (Object.entries(payload).some(([key, value]) => key !== "text" && value !== void 0)) return void 0;
		const text = typeof payload.text === "string" ? payload.text.trim() : "";
		if (!text || /[\r\n]/.test(text) || text.length > 240) return void 0;
		const match = text.match(/^(\S+)\s+(.+)$/u);
		if (!match || !/^\p{Extended_Pictographic}/u.test(match[1])) return void 0;
		const label = (match[2].split(":", 1)[0] ?? match[2]).trim();
		if (!label || label.length > 80) return void 0;
		return { key: `${match[1]}\u0000${label.toLowerCase()}`, icon: match[1], label };
	};
```

The `\u0000` separator matters: it prevents an icon from bleeding into the label, so
`🛠️` + `Exec` cannot collide with a hypothetical icon `🛠️ Exec`.

`aggregateCollapsibleToolSummary` then:

- returns `false` immediately if `!streamingEnabled` or `renderMode === "raw"`,
- calls `startStreaming()` and awaits `streamingStartPromise`,
- returns `false` if `!streaming?.isActive()`,
- calls `markVisibleReplySent()`,
- increments or seeds the Map entry,
- rebuilds `aggregatedToolSummaryLine` as
  `` `${icon} ${label}${count > 1 ? ` ×${count}` : ""}` `` joined by `\n`,
- clears `statusLine`,
- flushes via `flushStreamingCardUpdate(buildCombinedStreamText(reasoningText, streamText))`,
- returns `true`.

### Edit 6 — intercept before normal delivery

9.8 anchor:

```
			deliver: async (inputPayload, info) => {
				const prepared = await renderFeishuReplyPayload(inputPayload, {
```

→

```
			deliver: async (inputPayload, info) => {
				const collapsibleToolSummary = parseCollapsibleToolSummary(inputPayload, info);
				if (collapsibleToolSummary && await aggregateCollapsibleToolSummary(collapsibleToolSummary)) return noVisibleFeishuReplyDelivery;
				const prepared = await renderFeishuReplyPayload(inputPayload, {
```

`noVisibleFeishuReplyDelivery` is the plugin's existing sentinel for "handled, send
nothing". If that name changed, find the current sentinel in the same file.

### Edit 7 — keep the counts from being erased

9.8 anchor:

```
				const shouldDiscardStreamingPreview = info?.kind === "final" &&
```

→ prepend `aggregatedToolSummaryLine === "" &&`.

A `final` reply delivered as structured content discards the streaming preview. The
aggregate line exists **only** in that preview, so without this guard a structured final
silently wipes the tool summary.

## 4. Verify, in this order

```bash
node --check <patched-file>                     # syntax
sha256sum <patched-file>                        # record the new patched hash
node tests/contract.test.mjs                    # 19/19
patch --dry-run -p0 pristine.mjs < the.patch    # patch applies cleanly
```

Then update `EXPECTED_ORIG` and `EXPECTED_PATCHED` in `scripts/install.sh`, and the
hash table at the top of `README.md`.

The 9.8 port also regenerated the `.patch` with `diff -u original.mjs patched.mjs`, so
the committed diff is a plain unified diff between the two archived files. Generating it
with bare labels keeps the output stable across machines:

```bash
diff -u --label original.mjs --label patched.mjs original.mjs patched.mjs > the.patch
```

Verify the predicate did not drift between releases. `tests/contract.test.mjs` exercises
its own copy of the predicate, so it keeps passing even if the shipped one regressed —
compare the bundle against it explicitly:

```bash
node scripts/verify-predicate.mjs patched.mjs
# PREDICATE IDENTICAL
```

The script extracts the predicate from the bundle by brace-balanced scan, then compares
it against the test file. Whitespace and `\0` vs `\u0000` escape style are normalised
away; logic is not. On the 2026-09-30 regression it correctly reports `PREDICATE DIFFERS`.

## 5. Deploy

Back up → install → verify symbol count → restart → confirm the **new process** logs its
own Feishu reconnect chain. See `README.md` for platform restart commands and the
cold-start timing caveat.

## 6. What the tests do and do not cover

`tests/contract.test.mjs` exercises `parseCollapsibleToolSummary` only — the accept/reject
decision. It does not cover the streaming lifecycle (edits 2, 3, 4, 7), the intercept
plumbing (edit 6), or rendering. Those need an end-to-end check on a live gateway:
send a turn that makes several same-type tool calls and confirm a single `×N` line.

## 7. OpenClaw plugin-SDK deprecations to watch

Encountered while assessing `2026.10.1-beta.1`. All removal-pending, none referenced by
this patch — but re-check on each upgrade, since removal would break the assumptions above.

| Deprecation | Relevance |
|---|---|
| `message-presentation-legacy-bridges` | reply rendering path |
| `plugin-sdk-broad-runtime-barrels` | import style |
| `plugin-sdk-channel-setup-input-fields` | plugin setup |
| `media-legacy-projection` | media handling in the fail-open table |
| `plugin-sdk-provider-owned-helper-shims` | auth/model/stream helpers |

The patch touches a minified internal bundle, so it is not written against public SDK API
at all. The risk is not API removal — it is the internals simply moving. Always re-derive.