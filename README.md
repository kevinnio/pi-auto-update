# pi-auto-update

Pi extension that auto-updates pi and its packages (extensions), Claude Code style.

## Behavior

- On session start (once per process), checks a cooldown file.
  If the last check is older than the interval, runs `pi update --all` in the
  background (pi itself + all packages, pinned git refs reconciled to their
  configured ref, never moved).
- Quiet when already up to date. Notifies only when something was updated
  ("restart pi to apply") or the update failed.
- Skips when `PI_OFFLINE=1`, `--offline`, or in print/JSON mode.
- Cross-process lock prevents two pi sessions from updating simultaneously;
  stale locks (>30 min) are ignored.

## Files

- State: `~/.pi/agent/auto-update-state.json` (`lastCheck`, transient `runningSince`)
- Log: `~/.pi/agent/auto-update.log` (full output of every update run)

## Command

- `/update` — force an update now, ignoring the cooldown.

## Config

- `PI_AUTO_UPDATE_HOURS` — cooldown in hours (default 24).
