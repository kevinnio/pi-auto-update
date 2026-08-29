import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Auto-updates pi + its packages in the background on session start, like
// Claude Code: quiet check on a cooldown, `pi update --all` when due,
// notify only when something changed (or it failed). Restart pi to apply.

const SETTINGS_FILE = join(homedir(), ".pi", "agent", "settings.json");
const STATE_FILE = join(homedir(), ".pi", "agent", "auto-update-state.json");
const LOG_FILE = join(homedir(), ".pi", "agent", "auto-update.log");
const DEFAULT_INTERVAL_HOURS = 24;
const UPDATE_TIMEOUT_MS = 10 * 60_000;
const STALE_LOCK_MS = 30 * 60_000;

type State = { lastCheck?: string; runningSince?: string };

async function readState(): Promise<State> {
	try {
		return JSON.parse(await readFile(STATE_FILE, "utf8")) as State;
	} catch {
		return {};
	}
}

async function writeState(state: State): Promise<void> {
	await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

// setting key: "autoUpdateEnabled": false in ~/.pi/agent/settings.json disables
async function isEnabled(): Promise<boolean> {
	try {
		const settings = JSON.parse(await readFile(SETTINGS_FILE, "utf8")) as Record<string, unknown>;
		return settings.autoUpdateEnabled !== false;
	} catch {
		return true;
	}
}

async function setEnabled(enabled: boolean): Promise<void> {
	const raw = await readFile(SETTINGS_FILE, "utf8");
	const settings = JSON.parse(raw) as Record<string, unknown>;
	if (enabled) delete settings.autoUpdateEnabled;
	else settings.autoUpdateEnabled = false;
	await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

function isOffline(): boolean {
	return process.env.PI_OFFLINE === "1" || process.argv.includes("--offline");
}

function intervalMs(): number {
	const hours = Number(process.env.PI_AUTO_UPDATE_HOURS);
	return (hours > 0 ? hours : DEFAULT_INTERVAL_HOURS) * 3_600_000;
}

function isUpToDate(output: string): boolean {
	// pi update prints these when it had nothing to do
	return /already up[- ]to[- ]date|no updates|up to date/i.test(output) && !/changed \d+ packages?|Updated packages/i.test(output);
}

async function runUpdate(): Promise<{ ok: boolean; changed: boolean; tail: string }> {
	await appendFile(LOG_FILE, `\n===== ${new Date().toISOString()} pi update --all =====\n`, "utf8");
	const output = await new Promise<string>((resolve) => {
		let out = "";
		const child = spawn("pi", ["update", "--all"], { shell: true, windowsHide: true });
		const timer = setTimeout(() => child.kill(), UPDATE_TIMEOUT_MS);
		child.stdout.on("data", (d: Buffer) => (out += d));
		child.stderr.on("data", (d: Buffer) => (out += d));
		child.on("error", (err) => {
			clearTimeout(timer);
			out += `\nspawn error: ${err.message}`;
			resolve(out);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			out += `\nexit code: ${code ?? "killed"}`;
			resolve(out);
		});
	});
	await appendFile(LOG_FILE, output, "utf8");
	const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
	return {
		ok: /exit code: 0/.test(output),
		changed: !isUpToDate(output),
		tail: lines.slice(-3).join(" | "),
	};
}

async function maybeUpdate(force: boolean, ctx: ExtensionContext): Promise<void> {
	if (!(await isEnabled())) return;
	if (isOffline()) return;
	if (ctx.mode !== "tui" && ctx.mode !== "rpc") return; // print/json: pi exits fast, don't spawn npm under it

	const state = await readState();
	const now = Date.now();

	// Cross-process lock (multiple pi sessions): skip if another update is running
	if (state.runningSince) {
		const age = now - Date.parse(state.runningSince);
		if (age < STALE_LOCK_MS) return;
	}
	if (!force && state.lastCheck && now - Date.parse(state.lastCheck) < intervalMs()) return;

	await writeState({ ...state, runningSince: new Date().toISOString() });
	try {
		const result = await runUpdate();
		await writeState({ lastCheck: new Date().toISOString() });
		if (!result.ok) {
			ctx.ui.notify(`pi auto-update FAILED: ${result.tail} (log: ${LOG_FILE})`, "warning");
		} else if (result.changed) {
			ctx.ui.notify(`pi auto-update: updated pi/packages — restart pi to apply (${result.tail})`, "info");
		}
		// up to date: stay quiet, like claude code
	} finally {
		const current = await readState();
		await writeState({ lastCheck: current.lastCheck });
	}
}

// # ponytail: JSON round-trip drops comments in settings.json; pi settings are
// plain JSON today — if that changes, switch to a keyed patch instead.

export default function (pi: ExtensionAPI) {
	let started = false; // once per process; /new, /resume, /reload re-fire session_start

	pi.on("session_start", async (_event, ctx) => {
		if (started) return;
		started = true;
		void maybeUpdate(false, ctx); // fire-and-forget, never blocks startup
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
				ctx.ui.notify("pi auto-update is disabled — run /update on to enable", "warning");
				return;
			}
			ctx.ui.notify("pi auto-update: running pi update --all...", "info");
			await maybeUpdate(true, ctx);
		},
	});
}
