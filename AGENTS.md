# AGENTS.md: pi-auto-update

Pi extension (`src/index.ts`) that auto-updates pi and its packages in the background, Claude Code style. No npm dependencies; Node built-ins only.

## Layout

Split by concern, one job per file; nothing here is a framework.

| File | Concern |
| --- | --- |
| `src/index.ts` | Extension entry: session hook and `/update` command. The only file in the `pi` manifest. |
| `src/auto-update.ts` | Policy: when a check runs, and what the user is told about it. |
| `src/pi-update.ts` | Running `pi update --all`: spawn, timeout, process-tree kill, output capture and failure summary. |
| `src/changes.ts` | Pure decisions: what changed, by name, and how to read pi's output (snapshot diff, output fallbacks, Windows lock failures). |
| `src/snapshot.ts` | I/O only: reading the state pi mutates. Every wrapper the tests don't cover sits here. |
| `src/lock.ts` | Cross-process lock so two sessions never update at once. |
| `src/state.ts` | `lastCheck` cooldown state. |
| `src/settings.ts` | `autoUpdateEnabled` interop with pi's `settings.json`. |
| `src/log.ts` | Capped, best-effort run log. |
| `src/config.ts` | Paths and constants. Inert: no logic, no env reads. |
| `tests/changes.test.ts` | Tests for the pure change detection in `src/changes.ts`. |

## Invariants (do not break these)

- **Never block or crash a session.** The `session_start` handler is fire-and-forget with a `.catch` that only writes to the log. Anything added to the startup path must stay non-blocking and non-throwing.
- **Quiet on success.** Users get a notify only when something was updated ("restart pi to apply") or the update failed. Silence means "checked, nothing to do".
- **Kill the process tree on timeout** (`taskkill /T /F` on win32, `SIGTERM` elsewhere). `shell: true` means `child.kill()` alone orphans npm.
- **Log is capped** (~1MB → truncated to last 256KB) and every append is best-effort (`catch(() => {})`). Log failures must never fail the update.
- **Cross-process lock:** an atomically created `~/.pi/agent/auto-update.lock` (`open` with `wx`) prevents two pi sessions from updating at once; locks older than 30 minutes are considered stale and stolen.
- **A deferral is not a failure.** On Windows, a file-lock failure in npm's output (`EBUSY`, `-4082`, `4294963214`) that replaced nothing gives `runUpdate` the status `deferred`: the cooldown is deliberately left unset so the next session retries, and the notice is throttled via `lastDeferral` — except for a forced `/update`, which must always be answered because it already announced itself. Never write `lastCheck` for a deferred run. A lock failure that did replace packages stays `failed` so a half-finished run is still reported.
- **Mode guard:** only run in `tui`/`rpc`. In print/JSON mode pi exits immediately, and spawning npm under it risks a half-finished update.
- **Offline guard:** skip when `PI_OFFLINE=1` or `--offline` is in argv.

## How updates work

`pi update --all` (pi itself + all packages; pinned git refs are reconciled to their configured ref, never moved). State in `~/.pi/agent/auto-update-state.json` (`lastCheck` for the 24h cooldown), full output in `~/.pi/agent/auto-update.log`. Runs are user-visible only via notifications; npm/package output is never inherited into the TUI.

Whether anything actually changed is decided by diffing what pi mutates, not by reading its output: a snapshot of every pi-managed git clone's `git rev-parse HEAD` plus the resolved versions in the agent npm `package-lock.json`, taken before and after the run, in the agent dir and in `<cwd>/.pi`. `pi update` cannot answer this question itself — it prints `Updating <url>...` for every git source whether or not anything moved, and `Updated packages` unconditionally, while a moved clone with no `package.json` (or with unchanged deps) prints nothing distinguishable. `hasChanges()`/`selfUpdated()` remain as fallbacks for what a snapshot cannot see (git missing, lockfile writing disabled) and only match strings pi emits on a real change.

## Testing

```
npm test
```

`node:test` + type stripping, no test deps; `npm test` runs `tests/*.test.ts` (the glob is node's own — it is quoted so no shell expands it, which needs Node 22+). Tests cover the pure logic in `src/changes.ts`: `changedNames`, `selfUpdated`, `hasChanges`, `changedPackages`, `isWindowsLockFailure`. The fs/spawn wrappers in `src/snapshot.ts` and `runUpdate` are intentionally untested.

Detection is the part most likely to regress silently: a missed update means a user runs stale code, a spurious one means the daily "restart pi" toast that this was written to avoid. When adding a case, use real output copied from `~/.pi/agent/auto-update.log`, and check it against the snapshot semantics above rather than against the presence of any single string.

After changes also smoke-load the extension:

```
node --experimental-strip-types -e "import('./src/index.ts').then(m => console.log(typeof m.default))"
```

(should print `function`).

## Conventions

- TypeScript, loaded by pi via jiti. No build step, no compilation.
- One concern per file (see Layout). Do not add config systems, tools, or abstractions without removing something first.
- Keep the pure/impure line where it is: decisions in `changes.ts`, I/O in `snapshot.ts`. That is what keeps the decision testable without touching a real pi install.
- Relative imports carry the `.ts` extension: node's type stripping resolves nothing implicitly, and the smoke-load below runs these files through node directly.
- Only `src/index.ts` is listed in `package.json` `pi.extensions`. jiti loads it and resolves everything else as a plain module, so never call `pi.*` outside `index.ts` — a helper would otherwise become an extension in its own right.
- Settings interop: reads/writes `autoUpdateEnabled` in `~/.pi/agent/settings.json` via JSON round-trip (comments in that file would be lost; pi settings are plain JSON today).
- `pi` field in `package.json` (`"extensions": ["./src/index.ts"]`) is the entry point for git/npm installs. Keep it in sync if files move.
- `README.md` is for someone installing or using the extension: install, commands, config, files it writes, user-visible behaviour. Mechanism, rationale and architecture belong here or in code comments, never there.

## Release

Bump `version` in `package.json`, commit, push. Users install with `pi install https://github.com/kevinnio/pi-auto-update` and get updates through `pi update` (this repo is an unpinned git spec, so it moves with `main`).
