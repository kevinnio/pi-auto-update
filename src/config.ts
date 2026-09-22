import { homedir } from "node:os";
import { join } from "node:path";

// Inert: paths and constants only. Policy that reads the environment lives with the
// module that acts on it (see auto-update.ts).

export const AGENT_DIR = join(homedir(), ".pi", "agent");
export const SETTINGS_FILE = join(AGENT_DIR, "settings.json");
export const STATE_FILE = join(AGENT_DIR, "auto-update-state.json");
export const LOCK_FILE = join(AGENT_DIR, "auto-update.lock");
export const LOG_FILE = join(AGENT_DIR, "auto-update.log");

export const DEFAULT_INTERVAL_HOURS = 24;
export const UPDATE_TIMEOUT_MS = 10 * 60_000;
export const STALE_LOCK_MS = 30 * 60_000;
