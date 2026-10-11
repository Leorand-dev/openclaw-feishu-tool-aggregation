# Changelog

All notable changes to this patch set.

## 2026.10.1 — current

Target OpenClaw `2026.10.1` (`e178c39`), Feishu plugin `2026.10.1`.

- **The first port that required re-deriving an anchor.** Dry-running the 9.9 patch
  against the 10.1 bundle gave 6/7 with offset drift and one hard failure:

  ```
  Hunk #1 succeeded at 1730 (offset -30 lines).
  Hunk #2 FAILED at 1789.
  ...
  1 out of 7 hunks FAILED
  ```

  Upstream collapsed `buildCombinedStreamText` into a one-liner
  (`return [[…].filter(Boolean).join("\n\n---\n\n"), statusLine].filter(Boolean).join("\n\n")`),
  so none of the anchor text survived. Behaviour is unchanged — it is the *shape* that
  moved. Edit 2 was rewritten against the new form, prepending the aggregate line to the
  same `filter(Boolean)` chain that already drops empty segments. Edits 1, 3, 4, 5, 6, 7
  applied verbatim from the 9.9 patch with offset drift only.

- Edit 5's inserted block was **extracted from the 9.9 patch at patch time** rather than
  retyped, so the shipped predicate is byte-identical to 9.9 by construction.
  `verify-predicate.mjs` confirms this against the 10.1 bundle.

- **Two failed intermediate builds, then a real fix.** The 7-anchor port itself was fine;
  the streaming lifecycle took three attempts, and two of them shipped before the user
  noticed. Both failure modes are recorded because the final fix needs *both* halves.

  | build | cards/turn | aggregate line | symptom |
  |---|---|---|---|
  | v1 `8a32793c…` | 3–19 | yes | one card per tool group |
  | 方案 A `0336e454…` | 1 | **none** | 119s of silence, aggregation dead |
  | **C `69c2553e…`** | 1 | yes | current |

  *Why v1 produced many cards.* The aggregator called `startStreaming()`; upstream closes
  the card on every idle, so each tool group opened a fresh one. This had shipped since
  2026-09-30 and is visible in the 9.9 logs from 2026-10-09 12:10.

  *Why 方案 A killed aggregation.* Removing that `startStreaming()` looked like removing a
  side effect, but it was the load-bearing half. With `renderMode=auto`, the only upstream
  path that opens a card is `onPartialReply` — the first text token. Tool summaries
  therefore *always* arrive before any card exists, so `if (!streaming?.isActive()) return
  false` was structurally always true and aggregation could never fire. The card was
  correctly counted as "not many" because no card was opened at all.

  *The actual fix.* Keep the early `startStreaming()` — it is what gives the aggregate line
  somewhere to live — and stop the repeated cards at the **close** point instead:

  ```js
  onIdle: () => {
      if (aggregatedToolSummaryLine !== "" && !streamText && !reasoningText && deliveredFinalTexts.size === 0) return;
      queueIdleSideEffects();
  },
  ```

  The guard sits on `onIdle` rather than inside `queueIdleSideEffects`' do/while, so the
  load-bearing finalization loop is untouched. It releases on any sign the reply is
  arriving — streamed text, reasoning, or a delivered final — so the card cannot stay open
  indefinitely.

  **Known edge case, not handled:** a turn that ends after tool calls with no answer text
  and no delivered final would hold the card open. Not observed, but not ruled out.

- **Rewrote `tests/lifecycle.test.mjs` (14 checks).** The previous version asserted the
  patch adds no `startStreaming()` call site — which *passes* 方案 A and therefore endorsed
  the broken build. It now asserts both halves: the aggregator must open the card early,
  **and** `onIdle` must hold it open. Verified against all three builds — 方案 C 14/14,
  方案 A 6 failures, v1 3 failures. A lifecycle test that only catches one failure mode
  will bless the other.
- **Added `tests/lifecycle.test.mjs`** (9 checks). The 19 predicate tests could never catch
  this: they exercise an extracted copy of the accept/reject decision and never touch the
  streaming lifecycle. The new test runs against the shipped bundle and asserts the patch
  adds **no** `startStreaming()` call site. Verified in both directions — the fixed bundle
  passes 9/9, the buggy predecessor fails with `patched=6 original=5`. `install.sh` now runs
  it on the staged file alongside `verify-predicate.mjs` and refuses to install on failure.
- Replay-verified: `patch --dry-run` → apply → result is byte-identical to the archived
  `patched.mjs` (`cmp` clean), not merely "applies without error".

- No native tool-summary aggregation exists in 10.1 (`grep` for `parseCollapsibleToolSummary`
  and `aggregatedToolSummary*` returns 0), so the patch is not superseded by upstream.

- Original `9bbbd0c3baa9227ebeb6f719a317f990357236db46e2fd46b9eda5e81d2bd2d9`
  → patched `69c2553ed1faa08bcdee97fa9b9e087006645f448a67e74668507dba54cb6a5c`.
  (Superseded broken builds — do not use: `8a32793c…` many cards,
  `0336e454…` aggregation dead.)
- Patch file `1de8f591e7bf765d934bdfc83d72d5f49bad8b2558da79c240da560d89bcd1e4`.
- `install.sh` defaults to the 10.1 patch and both expected hashes; re-running it against
  an already-patched live file reports `already patched` and exits 0.

### Carried-forward lesson

Do not assume "the previous release's patch will apply." It held for 9.8→9.9 and broke at
9.9→10.1. Always dry-run first — the result is a cheap fork between "hash-only update"
and "re-derive anchors."

## 2026.9.9

Target OpenClaw `2026.9.9`, Feishu plugin `2026.9.9`.

- **Zero code change.** The 9.8 patch applied cleanly to the 9.9 bundle: all 7 hunks
  succeeded, `node --check` clean, and the result hash reproduced exactly. Only the hunk
  line offsets moved (+4 by the end of the file). The plugin generator changed the
  `monitor.account-*.mjs` build hash (`monitor.account-DuKFCzmA.mjs`), which is why this
  needed a fresh port rather than a copy of the old bundle.
- Patch body is byte-identical to the 9.8 patch apart from the `---`/`+++` labels and
  hunk offsets.
- Predicate verified verbatim against the 9.9 bundle; contract tests 19/19.
- Original `53bd8ecf58ec2eda5a8fdc32f14ae284bfdf99ed73cb7c20ea2a2c297173d4aa`
  → patched `140fad8e7b3764929d15bc6dbde74356adf617aa1d30564ffa8979ac47b3e7d5`.
- Patch file `6f5b44267715eb9182976b2566b55984da9088c9919d4c32d984d86004377264`.
- `scripts/install.sh` now defaults to the 9.9 patch and both expected hashes.

### Note on installing an older patch

Only the 10.1 hashes are compiled into `scripts/install.sh`. The installer deliberately
refuses a bundle whose hash it has not verified, so pointing it at an older patch file
alone will fail — edit both `EXPECTED_*` values too.

## 2026.9.8

Target OpenClaw `2026.9.8` (`fc23bc8`), Feishu plugin `2026.9.8`.

- Re-ported to the 9.8 bundle. 7 anchors, each matching exactly once.
- **Predicate changed from a key-name whitelist to a field-value `undefined` check.**
  The shipped-on-2026-09-30 variant had been rejecting every tool summary, because core
  appends `mediaUrls: undefined` and similar keys unconditionally. Checked against the
  9.8 bundle before porting; see `README.md` for the full explanation.
- `node --check` clean; contract tests 19/19.
- Original `df524437a7bc830be736ea5861599a31823c110e2dbc6dc688e4ce320622f88e`
  → patched `315954932e5b4ac5afe4069199a788e37016b3b9dae0caffc13160ce05f3d669`.

### Operational notes

Two findings worth carrying forward:

- **Cold start is slow enough to look like a failure.** Measured ~8s on macOS, ~10s on
  Linux with one Feishu account, and ~15s on Linux with seven accounts and five plugins.
  A `curl` issued immediately after restart returned `HTTP 000` against a gateway that
  was fully healthy seconds later. Confirm the listener with `ss -lntp` / `lsof` before
  concluding a restart failed, and allow ≥40s before probing.
- **`lsof -p <pid>` cannot prove the patch was loaded.** Node releases the module fd after
  import, so the patched file's absence from the process's open-file list proves nothing
  in either direction. Use the new process's own Feishu reconnect log lines instead.

## 2026.9.6 — earlier port

Target OpenClaw `2026.9.6`. 7 hunks. Used a key-name whitelist predicate, which is the
variant that broke in production on 2026-09-30 — see the note above. Retained here for
reference and diff comparison only.

- Patch: `5366d2bd4f13b2a9fcf6b63ebf4084aeed5ef2512abb0d13d2218ce3861ac48d`

## Compatibility

Reviewed against OpenClaw `2026.10.1-beta.1` (283 PRs): no native tool-summary
aggregation was found, so the patch remains applicable. The plugin-SDK deprecations
flagged by that release are all removal-pending and none are referenced here.
Not yet deployed to — or tested on — 10.x.

## Upgrade procedure

Every OpenClaw or Feishu-plugin update silently reverts this patch. Post-upgrade check:

```bash
grep -c parseCollapsibleToolSummary \
  ~/.openclaw/npm/projects/*/node_modules/@openclaw/feishu/dist/.setup/monitor.account-*.mjs
```

`0` means reverted. Then follow `docs/PORTING.md`.

## Operational note for 2026.9.9

A gateway upgrade that rewrites `dist/` invalidates the expected-original hash before it
invalidates the patched one, so the installer refuses loudly instead of half-applying.
That is the desired failure mode — but it means a port is required per release even when
no upstream code changed. When that happens, try the previous release's patch first; if
it applies cleanly and the predicate is unchanged, only the hashes need updating.