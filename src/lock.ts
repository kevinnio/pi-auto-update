import { open, stat, unlink } from "node:fs/promises";
import { LOCK_FILE, STALE_LOCK_MS } from "./config.ts";

// Atomic cross-process lock (exclusive create, no check-then-write race) so two pi
// sessions never update at once. A lock left behind by a crashed session is stolen
// once it is older than STALE_LOCK_MS.
export async function acquireLock(): Promise<boolean> {
	try {
		const handle = await open(LOCK_FILE, "wx");
		await handle.writeFile(String(process.pid), "utf8");
		await handle.close();
		return true;
	} catch {
		const info = await stat(LOCK_FILE).catch(() => null);
		if (!info || Date.now() - info.mtimeMs <= STALE_LOCK_MS) return false;
		await unlink(LOCK_FILE).catch(() => {});
		return acquireLock(); // once: if another session wins the steal race, we lose cleanly
	}
}

export async function releaseLock(): Promise<void> {
	await unlink(LOCK_FILE).catch(() => {});
}
