# pi-auto-update

Pi extension that auto-updates pi and its packages in the background, Claude Code style. On session start it checks a cooldown file and, when due, runs `pi update --all` out of sight (pi itself plus all packages). Quiet when already up to date; notifies only when something changed ("restart pi to apply", naming the packages that moved) or the update failed.

## How it knows something changed

Not from `pi update`'s output: that prints `Updating <url>...` for every git package whether or not anything moved, and `Updated packages` even when it did nothing at all. Instead the extension snapshots what pi mutates - every managed git clone's HEAD commit and the resolved versions in the npm lockfile - before and after the run. A package counts as updated only if its clone moved or its version changed.

## Install

```
pi install https://github.com/kevinnio/pi-auto-update
```

## Command

- `/update`: force an update now, ignoring the cooldown.
- `/update off` / `/update on`: disable or enable auto-updates.

## Config

- `"autoUpdateEnabled": false` in `~/.pi/agent/settings.json` disables it (same as `/update off`).
- `PI_AUTO_UPDATE_HOURS`: cooldown in hours (default 24).
- Respects `PI_OFFLINE=1` and `--offline`. Skips print/JSON mode so it never spawns npm under a run that exits immediately.

## Files

- State: `~/.pi/agent/auto-update-state.json` (24h cooldown timestamp)
- Lock: `~/.pi/agent/auto-update.lock` (cross-process, so two sessions never update at once; a lock left by a crashed session is stolen after 30 minutes)
- Log: `~/.pi/agent/auto-update.log` (full output of every run, capped at ~1MB)
