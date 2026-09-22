import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { maybeUpdate } from "./auto-update.ts";
import { appendLog } from "./log.ts";
import { isEnabled, setEnabled } from "./settings.ts";

// Updates pi and its packages in the background on session start, Claude Code style:
// a quiet check on a cooldown, `pi update --all` when due, and a notification only
// when something changed or the update failed.
//
// Only this file is loaded as an extension (package.json `pi.extensions`); everything
// it imports is a plain module, so no other file may call into the pi API.
export default function (pi: ExtensionAPI) {
	let started = false; // once per process; /new, /resume, /reload re-fire session_start

	pi.on("session_start", async (_event, ctx) => {
		if (started) return;
		started = true;
		void maybeUpdate(false, ctx).catch((err: unknown) => {
			// fire-and-forget: a failed check must never take the session down
			void appendLog(`auto-update crashed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
		});
	});

	pi.registerCommand("update", {
		description: "Update pi now (/update), or toggle: /update off|on",
		handler: async (args, ctx) => {
			const arg = args?.trim().toLowerCase();
			if (arg === "off" || arg === "on") {
				await setEnabled(arg === "on");
				ctx.ui.notify(`pi auto-update ${arg === "on" ? "enabled" : "disabled"} (saved to settings.json)`, "info");
				return;
			}
			if (!(await isEnabled())) {
				ctx.ui.notify("pi auto-update is disabled. Run /update on to enable.", "warning");
				return;
			}
			ctx.ui.notify("pi auto-update: running pi update --all...", "info");
			await maybeUpdate(true, ctx);
		},
	});
}
