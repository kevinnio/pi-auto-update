import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { isUpToDate } from "./index.ts";

describe("isUpToDate", () => {
	it("detects a real update", () => {
		const out = "changed 2 packages, and audited 232 packages in 2s\n\n138 packages are looking for funding\n\nfound 0 vulnerabilities\nUpdated packages\nexit code: 0";
		assert.equal(isUpToDate(out), false);
	});

	it("detects up-to-date phrasings", () => {
		assert.equal(isUpToDate("Everything is already up to date\nexit code: 0"), true);
		assert.equal(isUpToDate("All packages are up-to-date.\nexit code: 0"), true);
		assert.equal(isUpToDate("no updates found\nexit code: 0"), true);
	});

	it("an 'up to date' mention alongside real changes still counts as changed", () => {
		const out = "audit Fix 1 breakage\npackages found up to date were reinstalled\nchanged 1 package\nexit code: 0";
		assert.equal(isUpToDate(out), false);
	});

	it("detects failure exit codes as changed (so the user gets notified)", () => {
		assert.equal(isUpToDate("npm error something broke\nexit code: 1"), false);
	});
});
