import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_INTERVAL_HOURS, LOG_FILE } from "./config.ts";
import { acquireLock, releaseLock } from "./lock.ts";
import { runUpdate } from "./pi-update.ts";
import { isEnabled } from "./settings.ts";
import { readState, writeState } from "./state.ts";

// Policy: when a check runs, and what the user is told about the result.

// PI_OFFLINE=1 or --offline: never spawn pi while the user is offline on purpose
function isOffline(): boolean {
	return process.env.PI_OFFLINE === "1" || process.argv.includes("--offline");
}

function intervalMs(): number {
	const hours = Number(process.env.PI_AUTO_UPDATE_HOURS);
	return (hours > 0 ? hours : DEFAULT_INTERVAL_HOURS) * 3_600_000;
}

export async function maybeUpdate(force: boolean, ctx: ExtensionContext): Promise<void> {
	if (!(await isEnabled())) return;
	if (isOffline()) return;
	if (ctx.mode !== "tui" && ctx.mode !== "rpc") return; // print/json: pi exits fast, don't spawn npm under it

	const state = await readState();
	if (!force && state.lastCheck && Date.now() - Date.parse(state.lastCheck) < intervalMs()) return;

	if (!(await acquireLock())) {
		// forced runs already told the user "running..."; don't leave them hanging
		if (force) ctx.ui.notify("pi auto-update: another update is already running", "warning");
		return;
	}
	try {
		const result = await runUpdate(ctx.cwd);
		await writeState({ lastCheck: new Date().toISOString() });
		if (!result.ok) {
			ctx.ui.notify(`pi auto-update FAILED: ${result.tail} (log: ${LOG_FILE})`, "warning");
		} else if (result.names.length > 0) {
			ctx.ui.notify(`pi auto-update: updated ${result.names.join(", ")} — restart pi to apply`, "info");
		}
		// up to date: stay quiet, like claude code
	} finally {
		releaseLock();
	}
}
