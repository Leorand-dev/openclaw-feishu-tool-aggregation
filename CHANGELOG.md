# Changelog

All notable changes to this patch set.

## 2026.9.9 — current

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

Only the 9.9 hashes are compiled into `scripts/install.sh`. The installer deliberately
refuses a bundle whose hash it has not verified, so pointing it at the 9.8 patch file
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