import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { LOG_FILE } from "./config.ts";
import { acquireLock, releaseLock } from "./lock.ts";
import { appendLog } from "./log.ts";
import { runUpdate } from "./pi-update.ts";
import { isEnabled } from "./settings.ts";

// Policy: when a check runs, and what the user is told about the result.
// Every session start runs a check: pi announces pending package updates at every
// startup, so a timer here would leave the user hearing about updates the plugin
// chose not to make. The lock, not a cooldown, is what bounds the work.

// PI_OFFLINE=1 or --offline: never spawn pi while the user is offline on purpose
function isOffline(): boolean {
	return process.env.PI_OFFLINE === "1" || process.argv.includes("--offline");
}

export async function maybeUpdate(force: boolean, ctx: ExtensionContext): Promise<void> {
	if (!(await isEnabled())) return;
	if (isOffline()) return;
	if (ctx.mode !== "tui" && ctx.mode !== "rpc") return; // print/json: pi exits fast, don't spawn npm under it

	if (!(await acquireLock())) {
		// The other session is updating for us. Quiet in the background, but a forced
		// run already told the user "running...", so it must be answered either way.
		if (force) ctx.ui.notify("pi auto-update: another update is already running", "warning");
		else void appendLog("pi auto-update: skipped, another update is running\n");
		return;
	}
	try {
		const result = await runUpdate(ctx.cwd);
		if (result.status === "deferred") {
			// Nothing was replaced, so the next session retries on its own. The run's
			// output is already in the log; only a forced run is answered out loud.
			if (force) {
				ctx.ui.notify(
					"pi auto-update: skipped, package files are in use — close other pi runtimes and run /update",
					"info",
				);
			}
			return;
		}

		if (result.status === "failed") {
			ctx.ui.notify(`pi auto-update FAILED: ${result.tail} (log: ${LOG_FILE})`, "warning");
		} else if (result.names.length > 0) {
			ctx.ui.notify(`pi auto-update: updated ${result.names.join(", ")} — restart pi to apply`, "info");
		}
		// up to date: stay quiet, like claude code
	} finally {
		releaseLock();
	}
}
