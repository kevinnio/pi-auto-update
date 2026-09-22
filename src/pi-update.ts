import { spawn } from "node:child_process";
import { changedPackages, isWindowsLockFailure } from "./changes.ts";
import { UPDATE_TIMEOUT_MS } from "./config.ts";
import { appendLog } from "./log.ts";
import { snapshot } from "./snapshot.ts";

// Running `pi update --all` with its output captured and logged. Output is never
// inherited: npm noise would wreck the TUI.

type Result = { status: "ok" | "failed" | "deferred"; names: string[]; tail: string };

export async function runUpdate(cwd: string): Promise<Result> {
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
	const names = changedPackages(before, await snapshot(cwd), output);
	// A lock failure that replaced nothing was never attempted. One that did replace
	// something is a failure: npm installs sequentially, so the user still needs to hear
	// that the run stopped partway.
	const ok = /exit code: 0/.test(output);
	let status: Result["status"] = "ok";
	if (!ok) status = names.length === 0 && isWindowsLockFailure(output) ? "deferred" : "failed";
	return { status, names, tail: lines.slice(-3).join(" | ") };
}
