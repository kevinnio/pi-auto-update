import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// The entry point must load under node's type stripping, which is what proves the
// relative `.ts` imports between modules resolve. CI runs this on Linux and Windows.
describe("extension entry", () => {
	it("exports a factory function", async () => {
		const mod = await import("../src/index.ts");
		assert.equal(typeof mod.default, "function");
	});
});
