import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile, spawn } from "node:child_process";
import { readFile, writeFile, appendFile, stat, open, unlink, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

// Auto-updates pi + its packages in the background on session start, like
// Claude Code: quiet check on a cooldown, `pi update --all` when due,
// notify only when something changed (or it failed). Restart pi to apply.

const AGENT_DIR = join(homedir(), ".pi", "agent");
const SETTINGS_FILE = join(AGENT_DIR, "settings.json");
const STATE_FILE = join(AGENT_DIR, "auto-update-state.json");
const LOCK_FILE = join(AGENT_DIR, "auto-update.lock");
const LOG_FILE = join(AGENT_DIR, "auto-update.log");
const DEFAULT_INTERVAL_HOURS = 24;
const UPDATE_TIMEOUT_MS = 10 * 60_000;
const STALE_LOCK_MS = 30 * 60_000;

type State = { lastCheck?: string };
type FsState = { git: Record<string, string>; npm: Record<string, string> };

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
	const raw = await readFile(SETTINGS_FILE, "utf8").catch(() => "{}");
	const settings = JSON.parse(raw) as Record<string, unknown>;
	if (enabled) delete settings.autoUpdateEnabled;
	else settings.autoUpdateEnabled = false;
	// settings.json is round-tripped as JSON, so comments in it would be lost;
	// pi settings are plain JSON today. Switch to a keyed patch if that changes
	await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

function isOffline(): boolean {
	return process.env.PI_OFFLINE === "1" || process.argv.includes("--offline");
}

function intervalMs(): number {
	const hours = Number(process.env.PI_AUTO_UPDATE_HOURS);
	return (hours > 0 ? hours : DEFAULT_INTERVAL_HOURS) * 3_600_000;
}

const execFileAsync = promisify(execFile);

// `pi update` cannot tell us which package moved: it prints "Updating <url>..." for
// every git source whether or not anything changed, and a moved clone whose deps are
// unchanged prints npm's "up to date". So diff the state pi mutates instead.
async function revParse(dir: string): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", dir, "rev-parse", "HEAD"], { windowsHide: true })
		.catch(() => ({ stdout: "" }));
	return stdout.trim();
}

// every pi-managed clone under root, keyed by clone path. Never descends into .git
// (its presence is how a clone is recognised) or node_modules (thousands of entries,
// no clones). pi's ensureGitRef compares this same rev-parse output to decide whether
// to move a checkout, so a differing sha is that decision, re-read afterwards.
async function gitHeads(root: string): Promise<Record<string, string>> {
	const heads: Record<string, string> = {};
	const walk = async (dir: string): Promise<void> => {
		for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
			if (!entry.isDirectory() || entry.name === "node_modules") continue;
			if (entry.name === ".git") heads[dir] = await revParse(dir);
			else await walk(join(dir, entry.name));
		}
	};
	await walk(root);
	return heads;
}

// pi installs npm packages with `npm install <spec>@latest` in the agent npm root, so
// resolved versions in package-lock.json change iff the installed tree changed
async function npmVersions(lockPath: string): Promise<Record<string, string>> {
	try {
		const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
			packages?: Record<string, { version?: string }>;
		};
		return Object.fromEntries(
			Object.entries(lock.packages ?? {})
				.filter(([path]) => path)
				.map(([path, pkg]) => [path, pkg.version ?? ""]),
		);
	} catch {
		return {};
	}
}

export async function snapshot(cwd: string): Promise<FsState> {
	const git: Record<string, string> = {};
	const npm: Record<string, string> = {};
	for (const root of [AGENT_DIR, join(cwd, ".pi")]) {
		Object.assign(git, await gitHeads(join(root, "git")));
		Object.assign(npm, await npmVersions(join(root, "npm", "package-lock.json")));
	}
	return { git, npm };
}

// what changed between two snapshots, by package name
export function changedNames(before: FsState, after: FsState): string[] {
	const names = new Set<string>();
	const diff = (a: Record<string, string>, b: Record<string, string>, name: (key: string) => string) => {
		for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
			if (a[key] !== b[key]) names.add(name(key));
		}
	};
	diff(before.git, after.git, (key) => basename(key));
	diff(before.npm, after.npm, (key) => key.replace(/^.*node_modules\//, ""));
	return [...names];
}

export function selfUpdated(output: string): boolean {
	return /updated pi from \d/i.test(output);
}

// for what a snapshot can miss (git not on PATH, lockfile writing disabled). npm prints
// its diff only on a real change; "Updated packages", which pi prints unconditionally,
// is deliberately not matched here
function npmChanged(output: string): boolean {
	return /(?:added|removed|changed) \d+ packages?/i.test(output);
}

export function hasChanges(output: string): boolean {
	return selfUpdated(output) || npmChanged(output);
}

// atomic cross-process lock: exclusive-create lockfile, no check-then-write race.
// Stale locks (crashed session) are stolen after STALE_LOCK_MS.
async function acquireLock(): Promise<boolean> {
	try {
		const fh = await open(LOCK_FILE, "wx");
		await fh.writeFile(String(process.pid), "utf8");
		await fh.close();
		return true;
	} catch {
		const st = await stat(LOCK_FILE).catch(() => null);
		if (!st || Date.now() - st.mtimeMs <= STALE_LOCK_MS) return false;
		await unlink(LOCK_FILE).catch(() => {});
		return acquireLock(); // once: if another session wins the steal race, we lose cleanly
	}
}

async function releaseLock(): Promise<void> {
	await unlink(LOCK_FILE).catch(() => {});
}

// append with a size cap so months of daily runs can't grow the log unbounded
async function appendLog(text: string): Promise<void> {
	try {
		const st = await stat(LOG_FILE).catch(() => null);
		if (st && st.size > 1_000_000) {
			const tail = await readFile(LOG_FILE, "utf8");
			await writeFile(LOG_FILE, tail.slice(-256_000), "utf8");
		}
	} catch {
		// log rotation is best-effort; a failed rotation must never fail the update
	}
	await appendFile(LOG_FILE, text, "utf8").catch(() => {});
}

async function runUpdate(cwd: string): Promise<{ ok: boolean; names: string[]; tail: string }> {
	await appendLog(`\n===== ${new Date().toISOString()} pi update --all =====\n`);
	const before = await snapshot(cwd);
	const output = await new Promise<string>((resolve) => {
		let out = "";
		const child = spawn("pi", ["update", "--all"], {
			shell: true,
			windowsHide: true,
			// own process group on POSIX so the timeout can kill shell + npm together
			detached: process.platform !== "win32",
		});
		// kill the whole tree on timeout: shell:true means child.kill() only kills
		// the shell and leaves npm running. That matters when pi runs for weeks.
		const timer = setTimeout(() => {
			if (process.platform === "win32") {
				spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
			} else {
				try {
					process.kill(-child.pid!, "SIGTERM"); // negative pid = process group
				} catch {
					child.kill("SIGTERM");
				}
			}
		}, UPDATE_TIMEOUT_MS);
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
	await appendLog(output);
	const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
	const names = changedNames(before, await snapshot(cwd));
	if (names.length === 0 && selfUpdated(output)) names.push("pi");
	// only fires when a package moved that the snapshots could not see
	if (names.length === 0 && hasChanges(output)) names.push("pi/packages");
	return {
		ok: /exit code: 0/.test(output),
		names,
		tail: lines.slice(-3).join(" | "),
	};
}

async function maybeUpdate(force: boolean, ctx: ExtensionContext): Promise<void> {
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
