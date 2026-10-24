# AGENTS.md: pi-auto-update

Pi extension (`src/index.ts`) that auto-updates pi and its packages in the background, Claude Code style. No npm dependencies; Node built-ins only.

## Layout

One concern per file; nothing here is a framework.

| File | Concern |
| --- | --- |
| `src/index.ts` | Extension entry: session hook and `/update` command. The only file in the `pi` manifest. |
| `src/auto-update.ts` | Policy: when a check runs, when the user hears about it. |
| `src/pi-update.ts` | Running `pi update --all` and the stale-cache retry. |
| `src/changes.ts` | Pure decisions: what changed, how to read pi's output. |
| `src/snapshot.ts` | I/O only: reading the state pi mutates. |
| `src/lock.ts` | Cross-process lock so two sessions never update at once. |
| `src/state.ts` | Cooldown state. |
| `src/settings.ts` | `autoUpdateEnabled` interop with pi's `settings.json`. |
| `src/log.ts` | Capped, best-effort run log. |
| `src/config.ts` | Paths and constants. Inert: no logic, no env reads. |
| `tests/` | Tests for the pure logic, plus a smoke test that loads the entry point. |

## How it works

On session start, when the cooldown allows, run `pi update --all` out of sight. Output is logged, never inherited. Whether anything changed is decided by diffing what pi left on disk, since its output cannot answer that.

## Invariants (do not break these)

- **Never block or crash a session.** The startup path is fire-and-forget; failures only reach the log.
- **Quiet on success.** Notify only when something was updated ("restart pi to apply") or the update failed.
- **Kill the process tree on timeout**, not just the shell.
- **Logs never fail the update.** Appends are best-effort and the log is capped.
- **One updater at a time** across pi sessions.
- **A deferral is not a failure.** A file-lock collision that replaced nothing is retried next session and must not start the cooldown; a forced `/update` is always answered.
- **Stale metadata gets one retry, never a loop, and only pnpm's.** Clear the single package the error names, rerun once, and let the retry's result decide the status. Other managers' caches are left alone.
- **Only update in `tui`/`rpc` modes**, and never while offline.
- **Keep the pure/impure line.** Decisions live in `changes.ts`, their I/O in `snapshot.ts`.

## Testing

```
npm test
```

`node:test` + type stripping, no test deps, Node 22+. Covers the pure logic in `src/changes.ts`; the spawn/fs wrappers are intentionally untested. CI runs it on Linux and Windows. Detection is the part most likely to regress silently, so add cases from real log output.

## Conventions

- TypeScript loaded via jiti: no build step.
- Do not add config systems, tools, or abstractions without removing something first.
- Relative imports carry the `.ts` extension.
- Only `src/index.ts` may call `pi.*`; never a helper.
- `README.md` is for users (install, commands, config, files it writes, behaviour); mechanism and rationale live here or in code comments. Keep `pi.extensions` in `package.json` in sync if files move.

## Release

Bump `version`, commit, push. Users get updates through `pi update` (unpinned git spec, moves with `main`).
