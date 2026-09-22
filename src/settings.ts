import { readFile, writeFile } from "node:fs/promises";
import { SETTINGS_FILE } from "./config.ts";

// Interop with pi's settings.json, which holds the autoUpdateEnabled flag.

export async function isEnabled(): Promise<boolean> {
	try {
		const settings = JSON.parse(await readFile(SETTINGS_FILE, "utf8")) as Record<string, unknown>;
		return settings.autoUpdateEnabled !== false;
	} catch {
		return true;
	}
}

export async function setEnabled(enabled: boolean): Promise<void> {
	const raw = await readFile(SETTINGS_FILE, "utf8").catch(() => "{}");
	const settings = JSON.parse(raw) as Record<string, unknown>;
	if (enabled) delete settings.autoUpdateEnabled;
	else settings.autoUpdateEnabled = false;
	// settings.json is round-tripped as JSON, so comments in it would be lost; pi
	// settings are plain JSON today. Switch to a keyed patch if that changes
	await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n", "utf8");
}
