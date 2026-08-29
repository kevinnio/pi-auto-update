# AGENTS.md: pi-auto-update

Single-file pi extension (`index.ts`) that auto-updates pi and its packages in the background, Claude Code style. No npm dependencies; Node built-ins only.

## Invariants (do not break these)

- **Never block or crash a session.** The `session_start` handler is fire-and-forget with a `.catch` that only writes to the log. Anything added to the startup path must stay non-blocking and non-throwing.
- **Quiet on success.** Users get a notify only when something was updated ("restart pi to apply") or the update failed. Silence means "checked, nothing to do".
- **Kill the process tree on timeout** (`taskkill /T /F` on win32, `SIGTERM` elsewhere). `shell: true` means `child.kill()` alone orphans npm.
- **Log is capped** (~1MB → truncated to last 256KB) and every append is best-effort (`catch(() => {})`). Log failures must never fail the update.
- **Cross-process lock** in the state file (`runningSince`) prevents two pi sessions from updating at once; locks older than 30 minutes are considered stale and stolen.
- **Mode guard:** only run in `tui`/`rpc`. In print/JSON mode pi exits immediately, and spawning npm under it risks a half-finished update.
- **Offline guard:** skip when `PI_OFFLINE=1` or `--offline` is in argv.

## How updates work

`pi update --all` (pi itself + all packages; pinned git refs are reconciled to their configured ref, never moved). State in `~/.pi/agent/auto-update-state.json` (`lastCheck` for the 24h cooldown, transient `runningSince` lock), full output in `~/.pi/agent/auto-update.log`. Runs are user-visible only via notifications; npm/package output is never inherited into the TUI.

## Testing

```
npm test
```

`node:test` + type stripping, no test deps. Tests cover `isUpToDate` (the only non-trivial pure logic). The fs/spawn wrappers are intentionally untested. Real `pi update` output phrasings may change between pi versions; if a user reports a missed or spurious notification, that function is the first suspect. Add the observed output as a new test case.

After changes also smoke-load the extension:

```
node --experimental-strip-types -e "import('./index.ts').then(m => console.log(typeof m.default))"
```

(should print `function`).

## Conventions

- TypeScript, loaded by pi via jiti. No build step, no compilation.
- Keep it one file. The whole point of this extension is fast and simple; do not add config systems, tools, or abstractions without removing something first.
- Settings interop: reads/writes `autoUpdateEnabled` in `~/.pi/agent/settings.json` via JSON round-trip (comments in that file would be lost; pi settings are plain JSON today).
- `pi` field in `package.json` (`"extensions": ["./index.ts"]`) is the entry point for git/npm installs. Keep it in sync if files move.

## Release

Bump `version` in `package.json`, commit, push. Users install with `pi install https://github.com/kevinnio/pi-auto-update` and get updates through `pi update` (this repo is an unpinned git spec, so it moves with `main`).
