import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { AGENT_DIR } from "./config.ts";

// Reading the state `pi update` mutates, so changes.ts can diff it. All of the I/O
// lives here and none of the decisions do, which is what keeps changes.ts testable.

export type FsState = { git: Record<string, string>; npm: Record<string, string> };

const execFileAsync = promisify(execFile);

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

// What pi would touch in the agent dir and in the current project. Also useful by hand
// when checking detection against a real machine.
export async function snapshot(cwd: string): Promise<FsState> {
	const git: Record<string, string> = {};
	const npm: Record<string, string> = {};
	for (const root of [AGENT_DIR, join(cwd, ".pi")]) {
		Object.assign(git, await gitHeads(join(root, "git")));
		Object.assign(npm, await npmVersions(join(root, "npm", "package-lock.json")));
	}
	return { git, npm };
}
