import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { changedNames, changedPackages, hasChanges, selfUpdated } from "../src/changes.ts";

// verbatim from a no-op run: pi prints "Updated packages" unconditionally, so only the
// diff of what it left on disk can tell this apart from a real update
const NOOP_OUTPUT = `Updating https://github.com/kevinnio/pi-lmstudio...
Updating https://github.com/kevinnio/pi-auto-update...
Updated packages
pi is already up to date (v0.87.0)

exit code: 0`;

// verbatim: an npm package that really did move
const NPM_UPDATED_OUTPUT = `Updating npm:pi-mcp-adapter...
Updating https://github.com/kevinnio/pi-lmstudio...
Updating https://github.com/kevinnio/pi-auto-update...

changed 1 package, and audited 232 packages in 3s

Updated packages
pi is already up to date (v0.84.4)

exit code: 0`;

const base = { git: { "/git/github.com/kevinnio/pi-lmstudio": "d0219ab" }, npm: { "node_modules/pi-loop-police": "1.14.1" } };

describe("changedNames", () => {
	it("is empty when nothing moved", () => {
		assert.deepEqual(changedNames(base, structuredClone(base)), []);
	});

	it("detects a moved git clone by its HEAD sha", () => {
		const after = structuredClone(base);
		after.git["/git/github.com/kevinnio/pi-lmstudio"] = "9f2c1de";
		assert.deepEqual(changedNames(base, after), ["pi-lmstudio"]);
	});

	it("detects an npm package by its resolved version", () => {
		const after = structuredClone(base);
		after.npm["node_modules/pi-loop-police"] = "1.15.0";
		assert.deepEqual(changedNames(base, after), ["pi-loop-police"]);
	});

	it("detects a package that was installed", () => {
		const after = structuredClone(base);
		after.git["/git/github.com/kevinnio/pi-new"] = "abc1234";
		assert.deepEqual(changedNames(base, after), ["pi-new"]);
	});

	it("detects a package that was removed", () => {
		const after = structuredClone(base);
		delete after.npm["node_modules/pi-loop-police"];
		assert.deepEqual(changedNames(base, after), ["pi-loop-police"]);
	});

	it("names nested npm packages by the package itself", () => {
		const after = structuredClone(base);
		after.npm["node_modules/pi-mcp-adapter/node_modules/undici"] = "6.29.0";
		assert.deepEqual(changedNames(base, after), ["undici"]);
	});

	it("ignores a clone whose rev-parse failed both times", () => {
		const before = { git: { "/git/github.com/kevinnio/pi-broken": "" }, npm: {} };
		assert.deepEqual(changedNames(before, structuredClone(before)), []);
	});

	it("detects a moved clone even when pi's output reports nothing at all", () => {
		// pi-lmstudio has no package.json: a code-only move prints no npm output, and
		// "Updating <url>..." is printed for every git source regardless
		const after = structuredClone(base);
		after.git["/git/github.com/kevinnio/pi-lmstudio"] = "9f2c1de";
		assert.deepEqual(changedNames(base, after), ["pi-lmstudio"]);
	});
});

describe("selfUpdated", () => {
	it("detects pi itself moving", () => {
		assert.equal(selfUpdated("Updated pi from 0.85.1 to 0.87.0"), true);
	});

	it("is false when pi is current", () => {
		assert.equal(selfUpdated("pi is already up to date (v0.87.0)"), false);
	});
});

describe("hasChanges", () => {
	it("reports a no-op run as unchanged", () => {
		assert.equal(hasChanges(NOOP_OUTPUT), false);
	});

	it("reports an updated npm package", () => {
		assert.equal(hasChanges(NPM_UPDATED_OUTPUT), true);
	});

	it("reports a pi self-update", () => {
		assert.equal(hasChanges("Updated packages\nUpdated pi from 0.85.1 to 0.87.0\nexit code: 0"), true);
	});

	it("reports nothing for a failed run (the exit code drives that notification)", () => {
		assert.equal(hasChanges("npm error code EBUSY\nexit code: 1"), false);
	});
});

describe("changedPackages", () => {
	it("names the packages the snapshot saw move", () => {
		const after = structuredClone(base);
		after.npm["node_modules/pi-loop-police"] = "1.15.0";
		assert.deepEqual(changedPackages(base, after, NOOP_OUTPUT), ["pi-loop-police"]);
	});

	it("reports a no-op run as nothing at all", () => {
		assert.deepEqual(changedPackages(base, structuredClone(base), NOOP_OUTPUT), []);
	});

	it("falls back to pi when only its self-update line gives it away", () => {
		const output = "Updated packages\nUpdated pi from 0.85.1 to 0.87.0\nexit code: 0";
		assert.deepEqual(changedPackages(base, structuredClone(base), output), ["pi"]);
	});

	it("falls back to a generic label when only npm's output gives it away", () => {
		assert.deepEqual(changedPackages(base, structuredClone(base), NPM_UPDATED_OUTPUT), ["pi/packages"]);
	});

	it("prefers the names it can prove over the output fallback", () => {
		const after = structuredClone(base);
		after.git["/git/github.com/kevinnio/pi-lmstudio"] = "9f2c1de";
		assert.deepEqual(changedPackages(base, after, NPM_UPDATED_OUTPUT), ["pi-lmstudio"]);
	});
});
