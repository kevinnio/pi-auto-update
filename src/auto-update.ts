import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { LOG_FILE } from "./config.ts";
import { acquireLock, releaseLock } from "./lock.ts";
import { appendLog } from "./log.ts";
import type { Result } from "./pi-update.ts";
import { runUpdate } from "./pi-update.ts";
import { isEnabled } from "./settings.ts";

// Policy: when a check runs, and what the user is told about the result. Every
// session start runs a check: pi announces pending package updates at every
// startup, so a timer here would leave the user hearing about updates the plugin
// chose not to make. The lock, not a cooldown, is what bounds the work.

// What a run is worth saying, or nothing at all. A forced /update already told the
// user "running...", so it is answered even when the run was skipped; a background
// skip is left to the next session, and only reaches the log.
export function noticeFor(result: Result, force: boolean): { message: string; type: "info" | "warning" } | null {
	if (result.status === "failed") return { message: `pi auto-update FAILED: ${result.tail} (log: ${LOG_FILE})`, type: "warning" };
	if (result.status === "deferred") {
		const inUse = "pi auto-update: skipped, package files are in use — close other pi runtimes and run /update";
		return force ? { message: inUse, type: "info" } : null;
	}
	if (result.names.length === 0) return null; // up to date: stay quiet, like claude code
	return { message: `pi auto-update: updated ${result.names.join(", ")} — restart pi to apply`, type: "info" };
}

// PI_OFFLINE=1 or --offline: never spawn pi while the user is offline on purpose
function isOffline(): boolean {
	return process.env.PI_OFFLINE === "1" || process.argv.includes("--offline");
}

export async function maybeUpdate(force: boolean, ctx: ExtensionContext): Promise<void> {
	if (!(await isEnabled())) return;
	if (isOffline()) return;
	if (ctx.mode !== "tui" && ctx.mode !== "rpc") return; // print/json: pi exits fast, don't spawn npm under it

	if (!(await acquireLock())) {
		await appendLog("\npi auto-update: skipped, another update is running");
		if (force) ctx.ui.notify("pi auto-update: another update is already running", "warning");
		return;
	}
	try {
		const notice = noticeFor(await runUpdate(ctx.cwd), force);
		if (notice) ctx.ui.notify(notice.message, notice.type);
	} finally {
		releaseLock();
	}
}
