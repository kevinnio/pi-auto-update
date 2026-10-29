import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { noticeFor } from "../src/auto-update.ts";
import type { Result } from "../src/pi-update.ts";

const run = (over: Partial<Result>): Result => ({ status: "ok", names: [], tail: "", ...over });
const say = (result: Result, force: boolean) => noticeFor(result, force)?.message ?? "";

describe("noticeFor", () => {
	it("stays quiet when nothing moved", () => {
		assert.equal(noticeFor(run({}), false), null);
	});

	it("names the packages that moved", () => {
		const moved = run({ names: ["pi-mcp-adapter", "pi-lmstudio"] });
		assert.equal(noticeFor(moved, false)?.type, "info");
		assert.match(say(moved, false), /^pi auto-update: updated pi-mcp-adapter, pi-lmstudio\b/);
		assert.match(say(moved, false), /restart pi to apply$/);
	});

	it("warns with pi's last lines when the run failed", () => {
		const failed = run({ status: "failed", tail: "npm error ENOTFOUND" });
		assert.equal(noticeFor(failed, false)?.type, "warning");
		assert.match(say(failed, false), /FAILED: npm error ENOTFOUND \(log: /);
	});

	it("leaves a run skipped by another session to the next one", () => {
		assert.equal(noticeFor(run({ status: "deferred" }), false), null);
	});

	it("answers a forced run that was skipped", () => {
		assert.match(say(run({ status: "deferred" }), true), /files are in use.*run \/update/);
	});
});
