# pi-auto-update

Pi extension that auto-updates pi and its packages in the background, Claude Code style. On session start it runs `pi update --all` out of sight (pi itself plus all packages); only one session at a time does that work, so opening several terminals costs one update. Quiet when already up to date; notifies only when something changed ("restart pi to apply", naming the packages that moved) or the update failed.

## Install

```
pi install https://github.com/kevinnio/pi-auto-update
```

## Command

- `/update`: check and apply now, without waiting for the next session start.
- `/update off` / `/update on`: disable or enable auto-updates.

## Config

- `"autoUpdateEnabled": false` in `~/.pi/agent/settings.json` disables it (same as `/update off`).
- Respects `PI_OFFLINE=1` and `--offline`. Skips print/JSON mode so it never spawns npm under a run that exits immediately.

pi also checks at startup and prints "Package updates are available". That notice is pi's and it only tells you; this extension's check runs at the same moment and applies those updates in the background.

## Files

- Lock: `~/.pi/agent/auto-update.lock` (cross-process, so two sessions never update at once; a lock left by a crashed session is stolen after 30 minutes)
- Log: `~/.pi/agent/auto-update.log` (full output of every run, capped at ~1MB)
