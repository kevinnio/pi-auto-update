import { readFile, writeFile } from "node:fs/promises";
import { STATE_FILE } from "./config.ts";

// This extension's own state. `lastCheck` drives the cooldown between update runs.

export type State = { lastCheck?: string };

export async function readState(): Promise<State> {
	try {
		return JSON.parse(await readFile(STATE_FILE, "utf8")) as State;
	} catch {
		return {};
	}
}

export async function writeState(state: State): Promise<void> {
	await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}
