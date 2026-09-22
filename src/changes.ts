import { basename } from "node:path";
import type { FsState } from "./snapshot.ts";

// Whether a run changed anything, and what changed. Pure logic only — all I/O lives in
// snapshot.ts. Why diffing beats parsing pi's output: see AGENTS.md, "How updates work".

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

// The names to report, combining the snapshot diff with the output fallbacks.
export function changedPackages(before: FsState, after: FsState, output: string): string[] {
	const names = changedNames(before, after);
	if (names.length === 0 && selfUpdated(output)) names.push("pi");
	// only fires when a package moved that the snapshots could not see
	if (names.length === 0 && hasChanges(output)) names.push("pi/packages");
	return names;
}
