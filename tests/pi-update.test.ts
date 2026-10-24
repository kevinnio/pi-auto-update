import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { updateSteps } from "../src/pi-update.ts";

// verbatim from a real run: pnpm's cached metadata for the package predated the version
// its dependency asked for, so resolution failed although npm had it
const STALE = `Updating pi with pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 @earendil-works/pi-coding-agent@1.4.0...
[ERR_PNPM_NO_MATCHING_VERSION] No matching version found for @aws-sdk/token-providers@3.1155.0 while fetching it from https://registry.npmjs.org/

The latest release of @aws-sdk/token-providers is "3.1152.0".
Run \`pnpm store prune\` and retry \`pi update --self\`.

exit code: 1`;

const OK = "Updating pi with pnpm install -g --ignore-scripts pi@1.4.0...\n\nexit code: 0";

// replay canned outputs in order, recording every command
function fake(outputs: string[]) {
	const calls: string[] = [];
	const run = async (command: string, args: string[]) => {
		calls.push([command, ...args].join(" "));
		return outputs.shift() ?? "";
	};
	return { calls, run };
}

describe("updateSteps", () => {
	it("retries once after clearing only the stale package's cache", async () => {
		const { calls, run } = fake([STALE, "exit code: 0", OK]);
		const steps = await updateSteps(run);

		assert.deepEqual(calls, [
			"pi update --all",
			"pnpm cache delete @aws-sdk/token-providers",
			"pi update --all",
		]);
		assert.equal(steps.at(-1)?.output, OK);
	});

	it("stops after the retry, so a second failure is reported", async () => {
		const { calls, run } = fake([STALE, "exit code: 0", STALE]);
		const steps = await updateSteps(run);

		assert.equal(calls.length, 3);
		assert.equal(steps.at(-1)?.output, STALE);
	});

	it("does not clean anything when the update worked", async () => {
		const { calls, run } = fake([OK]);
		await updateSteps(run);

		assert.deepEqual(calls, ["pi update --all"]);
	});

	it("does not clean another manager's cache", async () => {
		const npm = "Updating pi with npm install -g pi@1.4.0...\nnpm error notarget No matching version found for pi@1.4.0\n\nexit code: 1";
		const { calls, run } = fake([npm]);
		await updateSteps(run);

		assert.deepEqual(calls, ["pi update --all"]);
	});
});
