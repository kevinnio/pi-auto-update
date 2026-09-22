import { appendFile, readFile, stat, writeFile } from "node:fs/promises";
import { LOG_FILE } from "./config.ts";

// Full output of every run, capped so months of daily updates can't grow it unbounded.
// Best-effort throughout: a failed or unrotatable log must never fail an update.

const MAX_BYTES = 1_000_000;
const KEEP_BYTES = 256_000;

export async function appendLog(text: string): Promise<void> {
	try {
		const info = await stat(LOG_FILE).catch(() => null);
		if (info && info.size > MAX_BYTES) {
			await writeFile(LOG_FILE, (await readFile(LOG_FILE, "utf8")).slice(-KEEP_BYTES), "utf8");
		}
	} catch {
		// rotation is best-effort
	}
	await appendFile(LOG_FILE, text, "utf8").catch(() => {});
}
