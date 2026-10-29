# pi-auto-update

Updates pi and everything you installed into it, in the background, so you do not have to remember to.

## Install

```
pi install https://github.com/kevinnio/pi-auto-update
```

## Commands

| Command | What it does |
| --- | --- |
| `/update` | Update pi and all installed packages now |
| `/update off` | Stop auto-updating |
| `/update on` | Auto-update again |

## Config

`"autoUpdateEnabled": false` in `~/.pi/agent/settings.json` turns it off. Same as `/update off`.

## What you will see

- Nothing, when everything is already up to date.
- A notice naming the packages that were updated, and telling you to restart pi. Restart, because the session you are in keeps running the old code.
- A failure notice when pi could not update. It tells you which log to read.
- Nothing, when the update was skipped because another pi window is already updating or holding the package files. The next start retries. Run `/update` yourself and it says so out loud.

pi prints its own "Package updates are available" notice. That only reports updates, this extension is what applies them.

Auto-update runs when you start an interactive pi session, and not when you are offline (`PI_OFFLINE=1`, `--offline`) or running pi once through `-p` or `--mode print|json`.

## Files it writes

| Path | What it is for |
| --- | --- |
| `~/.pi/agent/auto-update.log` | What each update did. Read it when something failed or nothing happened |
| `~/.pi/agent/auto-update.lock` | Keeps two pi windows from updating at the same time |
