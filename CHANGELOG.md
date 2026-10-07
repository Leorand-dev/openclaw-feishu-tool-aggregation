# Changelog

All notable changes to this patch set.

## 2026.9.8 — current

Target OpenClaw `2026.9.8` (`fc23bc8`), Feishu plugin `2026.9.8`.

- Re-ported to the 9.8 bundle. 7 anchors, each matching exactly once.
- **Predicate changed from a key-name whitelist to a field-value `undefined` check.**
  The shipped-on-2026-09-30 variant had been rejecting every tool summary, because core
  appends `mediaUrls: undefined` and similar keys unconditionally. Checked against the
  9.8 bundle before porting; see `README.md` for the full explanation.
- `node --check` clean; contract tests 19/19.
- Original `df524437a7bc830be736ea5861599a31823c110e2dbc6dc688e4ce320622f88e`
  → patched `315954932e5b4ac5afe4069199a788e37016b3b9dae0caffc13160ce05f3d669`.

### Deployment record

Deployed to four OpenClaw 2026.9.8 hosts — three Linux/systemd, one macOS/launchd.
Feishu account counts ranged from 1 to 7. Deployed hashes were byte-identical on all four,
so a single `patched.mjs` was distributed unchanged.

Two operational findings worth carrying forward:

- **Cold start is slow enough to look like a failure.** Measured ~8s on macOS, ~10s on
  Linux with one Feishu account, ~15s on Linux with seven accounts and five plugins. A
  `curl` issued immediately after restart returned `HTTP 000` against a gateway that
  was fully healthy seconds later. Confirm the listener with `ss -lntp` / `lsof` before
  concluding a restart failed, and allow ≥40s before probing.
- **`lsof -p <pid>` cannot prove the patch was loaded.** Node releases the module fd after
  import, so the patched file's absence from the process's open-file list proves nothing
  in either direction. Use the new process's own Feishu reconnect log lines instead.

An unrelated pre-existing fault was observed on one of the four hosts
(`SESSION_CANONICAL_KEY_MIGRATION_REQUIRED` blocking memory-core's dreaming startup
cleanup). Not caused by this patch and not addressed by it.

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