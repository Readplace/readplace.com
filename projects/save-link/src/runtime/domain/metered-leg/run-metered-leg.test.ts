import assert from "node:assert/strict";
import type { HutchLogger } from "@packages/hutch-logger";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import type { PaidLegPermit } from "@packages/provider-contracts/metered-leg-ledger";
import { legInputHash } from "./leg-input-hash";
import { initRunMeteredLeg } from "./run-metered-leg";

const URL = "https://example.com/article";
const NOW = new Date("2026-11-04T10:00:00.000Z");

function recordingLogger() {
	const lines: unknown[][] = [];
	const logger: HutchLogger = {
		info: (...args: unknown[]) => {
			lines.push(args);
		},
		warn: () => {},
		error: () => {},
		debug: () => {},
	};
	return { logger, lines };
}

function setup(options: { deferred: boolean } = { deferred: false }) {
	const ledger = initInMemoryMeteredLegLedger({ now: () => NOW, isMeteredLegsDeferred: () => options.deferred });
	const { logger, lines } = recordingLogger();
	const runMeteredLeg = initRunMeteredLeg({ ...ledger, logger, now: () => NOW });
	const actions = () => lines.map(([, data]) => data);
	return { ledger, runMeteredLeg, actions };
}

const request = (claimId: string) => ({
	url: URL,
	leg: "summary" as const,
	inputs: ["content-hash-1"],
	claimId,
	claimTtlMs: 15 * 60_000,
});

describe("initRunMeteredLeg", () => {
	it("runs a granted leg with a permit for the hashed inputs and settles its outcome", async () => {
		const { ledger, runMeteredLeg, actions } = setup();
		const permits: PaidLegPermit[] = [];

		const result = await runMeteredLeg({
			...request("message-1"),
			run: async (permit) => {
				permits.push(permit);
				return { kind: "succeeded", outcome: "summary-hash" };
			},
		});

		assert.deepEqual(result, { kind: "ran", outcome: "summary-hash" });
		assert.deepEqual(permits, [
			{
				leg: "summary",
				claimId: "message-1",
				inputHash: legInputHash({ url: URL, leg: "summary", inputs: ["content-hash-1"] }),
			},
		]);
		assert.deepEqual(await ledger.claimMeteredLeg({ ...request("message-2"), inputHash: permits[0].inputHash, expiresAt: NOW.toISOString() }), {
			kind: "settled",
			outcome: "summary-hash",
		});
		assert.deepEqual(actions(), [
			{ url: URL, leg: "summary", action: "claimed" },
			{ url: URL, leg: "summary", action: "settled" },
		]);
	});

	it("claims until now plus the claim ttl", async () => {
		const { ledger } = setup();
		const expiries: string[] = [];
		const runMeteredLeg = initRunMeteredLeg({
			...ledger,
			claimMeteredLeg: async (p) => {
				expiries.push(p.expiresAt);
				return { kind: "in-flight" };
			},
			logger: recordingLogger().logger,
			now: () => NOW,
		});

		await runMeteredLeg({ ...request("message-1"), run: async () => ({ kind: "unsucceeded" }) });

		assert.deepEqual(expiries, ["2026-11-04T10:15:00.000Z"]);
	});

	it("releases the claim when the run does not succeed", async () => {
		const { ledger, runMeteredLeg, actions } = setup();
		const permits: PaidLegPermit[] = [];

		const result = await runMeteredLeg({
			...request("message-1"),
			run: async (permit) => {
				permits.push(permit);
				return { kind: "unsucceeded" };
			},
		});

		assert.deepEqual(result, { kind: "ran-unsucceeded" });
		assert.equal(
			(await ledger.claimMeteredLeg({ ...request("message-2"), inputHash: permits[0].inputHash, expiresAt: NOW.toISOString() })).kind,
			"granted",
		);
		assert.deepEqual(actions(), [
			{ url: URL, leg: "summary", action: "claimed" },
			{ url: URL, leg: "summary", action: "released" },
		]);
	});

	it("releases the claim and rethrows when the run throws", async () => {
		const { ledger, runMeteredLeg, actions } = setup();
		const permits: PaidLegPermit[] = [];

		await expect(
			runMeteredLeg({
				...request("message-1"),
				run: async (permit) => {
					permits.push(permit);
					throw new Error("provider down");
				},
			}),
		).rejects.toThrow("provider down");

		assert.equal(
			(await ledger.claimMeteredLeg({ ...request("message-2"), inputHash: permits[0].inputHash, expiresAt: NOW.toISOString() })).kind,
			"granted",
		);
		assert.deepEqual(actions(), [
			{ url: URL, leg: "summary", action: "claimed" },
			{ url: URL, leg: "summary", action: "released" },
		]);
	});

	it("answers deferred without running while the article's metered legs are deferred", async () => {
		const { runMeteredLeg, actions } = setup({ deferred: true });
		let ran = 0;

		const result = await runMeteredLeg({
			...request("message-1"),
			run: async () => {
				ran += 1;
				return { kind: "succeeded", outcome: "x" };
			},
		});

		assert.deepEqual(result, { kind: "deferred" });
		assert.equal(ran, 0);
		assert.deepEqual(actions(), [{ url: URL, leg: "summary", action: "deferred" }]);
	});

	it("answers the settled outcome without running for inputs already settled", async () => {
		const { runMeteredLeg, actions } = setup();
		await runMeteredLeg({ ...request("message-1"), run: async () => ({ kind: "succeeded", outcome: "first" }) });
		let ran = 0;

		const result = await runMeteredLeg({
			...request("message-2"),
			run: async () => {
				ran += 1;
				return { kind: "succeeded", outcome: "second" };
			},
		});

		assert.deepEqual(result, { kind: "settled", outcome: "first" });
		assert.equal(ran, 0);
		assert.deepEqual(actions().at(-1), { url: URL, leg: "summary", action: "skipped-settled" });
	});

	it("answers in-flight without running while another holder's claim is live", async () => {
		const { runMeteredLeg, actions } = setup();
		let release: () => void = () => {};
		const first = runMeteredLeg({
			...request("message-1"),
			run: () =>
				new Promise((resolve) => {
					release = () => resolve({ kind: "succeeded", outcome: "first" });
				}),
		});
		let ran = 0;

		const second = await runMeteredLeg({
			...request("message-2"),
			run: async () => {
				ran += 1;
				return { kind: "succeeded", outcome: "second" };
			},
		});
		release();
		await first;

		assert.deepEqual(second, { kind: "in-flight" });
		assert.equal(ran, 0);
		assert.deepEqual(actions()[1], { url: URL, leg: "summary", action: "skipped-in-flight" });
	});
});
