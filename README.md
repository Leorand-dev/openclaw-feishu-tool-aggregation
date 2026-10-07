# Feishu Tool-Summary Aggregation Patch for OpenClaw

Collapse consecutive Feishu tool-call bubbles into a single counted line — `🛠️ Exec ×4` —
instead of one message per tool call. Shipped and verified on **OpenClaw 2026.9.8**.

While `verbose` is on, a burst of tool calls in Feishu produces one bubble per call, and
the reply card becomes a wall of near-identical lines. This patch folds same-icon + same-label
summaries into one line with a multiplier, rendered above the final answer.

| | |
|---|---|
| Target OpenClaw | **2026.9.8** (`fc23bc8`) |
| Target file | `<plugin>/dist/.setup/monitor.account-*.mjs` (minified bundle; name is build-specific) |
| Original SHA256 | `df524437a7bc830be736ea5861599a31823c110e2dbc6dc688e4ce320622f88e` |
| Patched SHA256 | `315954932e5b4ac5afe4069199a788e37016b3b9dae0caffc13160ce05f3d669` |
| Edits | 7 anchors, each required to match exactly once |
| Contract tests | 19/19 pass |

---

## Behaviour

### Collapses

```
🛠️ Exec: ls -la          ─┐
📖 Read: /etc/hosts       ├─▶  🛠️ Exec ×3
🛠️ EXEC: df -h            │
🛠️ Exec: journalctl       ─┘
```

Grouping key is `icon + NUL + lowercased label`, so `Exec` and `EXEC` fold together.
Rendering is one entry per line — mixed types do not collapse into one line:

```
🛠️ Exec ×2
📖 Read ×3
```

### Fails open (renders as the original per-call bubble)

Every one of these is deliberately **not** collapsed:

| Case | Why |
|---|---|
| `payload.isError === true` | a failed call stays individually visible |
| `mediaUrl` / `mediaUrlFull` / non-empty `mediaUrls` | media needs its own bubble |
| `audioAsVoice === true` | voice notes are delivered natively |
| non-empty `payload.channelData` | approvals, interactive cards, buttons |
| text containing `\r` or `\n` | `/verbose full` multi-line output |
| text longer than 240 chars | not a one-line summary |
| first token not `\p{Extended_Pictographic}` | plain text is not a tool chip |
| empty text | — |
| streaming disabled or `renderMode === "raw"` | — |
| gateway not streaming yet (`!streaming?.isActive()`) | returns false, normal path |

The last row matters: aggregation is opportunistic. If the card isn't streaming yet, the
call is delivered normally rather than dropped.

---

## Install

```bash
./scripts/install.sh
# or against an explicit patch file:
./scripts/install.sh patches/feishu-tool-aggregation-2026.9.8.patch
```

The installer:

1. discovers the target under `~/.openclaw/npm/projects` (no hardcoded paths),
2. hashes the current file — exits early if already patched,
3. **refuses** if the hash is not the expected original,
4. backs up to `~/.openclaw/patches/<timestamp>/original.mjs`,
5. `patch --dry-run` → `patch` → `node --check`,
6. verifies the result hash equals the expected patched hash before installing.

### Restart

| Platform | Command |
|---|---|
| Linux / systemd | `systemctl --user restart openclaw-gateway` |
| macOS / launchd | `launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway` |

The installer prints the right one for you.

> **Allow 40s before probing health.** Cold start was measured at ~8s (macOS),
> ~10s (Linux, 1 Feishu account) and ~15s (Linux, 7 Feishu accounts, 5 plugins).
> A single short `curl` right after restart can return `HTTP 000` on a perfectly
> healthy gateway. Confirm with `ss -lntp | grep 18789` or `lsof -iTCP:18789 -sTCP:LISTEN`
> before concluding anything is wrong.

### Verify

```bash
# must print 2
grep -c parseCollapsibleToolSummary \
  ~/.openclaw/npm/projects/*/node_modules/@openclaw/feishu/dist/.setup/monitor.account-*.mjs
```

`0` means the file was **overwritten** — see [Re-applying after an upgrade](#re-applying-after-an-upgrade).

Stronger evidence that the *running process* loaded it: after a restart, the new
process logs its own Feishu reconnect chain.

```
[feishu] starting feishu[default] (mode: websocket)
[feishu] bot open_id resolved: ou_…
[feishu] starting WebSocket connection...
[feishu] WebSocket client started
```

`lsof -p <pid>` is **not** usable here — Node releases the fd after loading the module,
so its absence proves nothing.

---

## The predicate: why it checks values, not key names

This is the single most important thing to carry forward when porting.

The first version of this patch used a key-name whitelist: aggregate only if the payload's
own keys were drawn from an allowed set. **It rejected 100% of tool summaries** once
shipped on 2026-09-30, because core appends its own keys unconditionally — including
keys whose *values* are `undefined`:

```js
{ text: "🛠️ Exec: ls", mediaUrls: undefined, channelData: undefined }
```

A key-name whitelist sees `mediaUrls` and bails. The shipped fix checks field **values**:

```js
if (Object.entries(payload).some(([key, value]) => key !== "text" && value !== void 0)) return void 0;
```

Any key other than `text` that holds a real value disqualifies the summary; keys holding
`undefined` are core's own scaffolding and are ignored. The guard against unknown new
core fields is preserved — they just have to carry a value.

This case is locked down by a regression test:

```
PASS  core's own undefined keys pass open
```

---

## The 7 edits

Each anchor is asserted to match **exactly once**; the port script aborts otherwise.

| # | Anchor (conceptually) | Effect |
|---|---|---|
| 1 | reply-scoped state declarations | adds `aggregatedToolSummaryCounts` Map + `aggregatedToolSummaryLine` |
| 2 | `buildCombinedStreamText` | prepends the aggregate line above reasoning and answer |
| 3 | streaming reset | clears counts and line |
| 4 | new-reply start | clears counts and line |
| 5 | before `sendChunkedTextReply` | inserts `parseCollapsibleToolSummary` + `aggregateCollapsibleToolSummary` |
| 6 | `deliver` handler | intercepts eligible summaries, returns `noVisibleFeishuReplyDelivery` when folded |
| 7 | `shouldDiscardStreamingPreview` | adds `aggregatedToolSummaryLine === "" &&` so a structured/media final cannot erase the counts |

Edit 7 is the subtle one: without it, a final reply that arrives as structured content
discards the streaming preview — and the aggregate line lives only in that preview.

---

## Tests

```bash
node tests/contract.test.mjs
# 19 passed, 0 failed
```

The predicate is extracted verbatim from the patched bundle, so the tests track the
shipped behaviour rather than a reimplementation. Covers: shell/read/search/memory
summaries, case-insensitive grouping, and every fail-open row in the table above.

---

## Re-applying after an upgrade

Any OpenClaw or Feishu-plugin update rewrites `dist/` and **silently reverts this patch**.
Symptom: tool bubbles return to one-per-call.

```bash
grep -c parseCollapsibleToolSummary \
  ~/.openclaw/npm/projects/*/node_modules/@openclaw/feishu/dist/.setup/monitor.account-*.mjs
```

`0` → gone. Then:

1. back up the new pristine file,
2. update `EXPECTED_ORIG` in `scripts/install.sh`,
3. re-derive the 7 anchors against the new bundle,
4. recompute and record the new patched hash,
5. update `EXPECTED_PATCHED` and the table at the top of this README,
6. `node tests/contract.test.mjs` must still be 19/19.

**Do not** raise the expected-original hash to whatever you happen to find in order to
make the installer pass. A hash mismatch means the anchors are unverified — the
installer refusing is the safety property doing its job.

Porting notes and the full anchor list: [`docs/PORTING.md`](docs/PORTING.md).
Version history: [`CHANGELOG.md`](CHANGELOG.md).

---

## Compatibility notes

Built and deployed against the Feishu plugin's streaming card renderer. Assumes:

- streaming enabled (`streaming.mode: "partial"` works; `renderMode` not `raw`)
- the plugin's `deliver` interception point and `noVisibleFeishuReplyDelivery` sentinel
- `buildCombinedStreamText(thinking, answer)` still being the card text composer

None of these are public plugin-SDK API. Treat every OpenClaw upgrade as a re-verification
event, not a formality.

OpenClaw `2026.10.1-beta.1` was reviewed for compatibility and shows no native tool-summary
aggregation; the relevant plugin-SDK deprecations
(`message-presentation-legacy-bridges`, `plugin-sdk-broad-runtime-barrels`,
`plugin-sdk-channel-setup-input-fields`, `media-legacy-projection`) are all
removal-pending and none are referenced by this patch.

---

## Provenance

Developed and verified across four OpenClaw 2026.9.8 hosts — three Linux (systemd),
one macOS (launchd) — with 1 and 7 Feishu accounts respectively. Deployed file hashes
were byte-identical across all four, so the same `patched.mjs` was distributed unchanged.

Behaviour verified end-to-end on one host; verified as correctly loaded on the rest.
Rendering should be spot-checked after each upgrade.

## Licence

MIT — see [`LICENSE`](LICENSE). Not affiliated with or endorsed by OpenClaw or Lark/Feishu.