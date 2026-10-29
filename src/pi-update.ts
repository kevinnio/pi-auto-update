import { spawn } from "node:child_process";
import { cacheClean, changedPackages, isWindowsLockFailure } from "./changes.ts";
import { UPDATE_TIMEOUT_MS } from "./config.ts";
import { appendLog } from "./log.ts";
import { snapshot } from "./snapshot.ts";

// Running `pi update --all` with its output captured and logged. Output is never
// inherited: npm noise would wreck the TUI.

export type Result = { status: "ok" | "failed" | "deferred"; names: string[]; tail: string };
type Runner = (command: string, args: string[]) => Promise<string>;
export type Step = { command: string; args: string[]; output: string };

// One `pi update --all`, plus the single stale-pnpm-metadata retry: stale metadata
// fails every run until the one package listing is dropped, and pi only prints a hint
// to do it by hand. Clear just that package and run once more, so a real failure still
// ends in the failure notification. The runner is a parameter so the sequencing is
// testable without spawning anything.
export async function updateSteps(run: Runner = capture): Promise<Step[]> {
	const steps: Step[] = [];
	const take = async (command: string, args: string[]): Promise<string> => {
		const output = await run(command, args);
		steps.push({ command, args, output });
		return output;
	};

	const first = await take("pi", ["update", "--all"]);
	const clean = succeeded(first) ? null : cacheClean(first);
	if (!clean) return steps;

	await take(clean.command, clean.args);
	await take("pi", ["update", "--all"]);
	return steps;
}

export async function runUpdate(cwd: string): Promise<Result> {
	await appendLog(`\n===== ${new Date().toISOString()} pi update --all =====\n`);

	const before = await snapshot(cwd);
	const steps = await updateSteps();
	await appendLog(steps[0].output);
	for (const step of steps.slice(1)) {
		await appendLog(`\n===== ${step.command} ${step.args.join(" ")} =====\n${step.output}`);
	}

	const output = steps[steps.length - 1].output;
	const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
	const names = changedPackages(before, await snapshot(cwd), output);
	// A lock failure that replaced nothing was never attempted. One that did replace
	// something is a failure: npm installs sequentially, so the user still needs to hear
	// that the run stopped partway.
	let status: Result["status"] = "ok";
	if (!succeeded(output)) status = names.length === 0 && isWindowsLockFailure(output) ? "deferred" : "failed";
	return { status, names, tail: lines.slice(-3).join(" | ") };
}

function succeeded(output: string): boolean {
	return /\nexit code: 0$/.test(output.trimEnd());
}

// Runs a command with its output captured; output is never inherited (npm noise would
// wreck the TUI).
function capture(command: string, args: string[]): Promise<string> {
	return new Promise<string>((resolve) => {
		let out = "";
		const child = spawn(command, args, {
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
}
