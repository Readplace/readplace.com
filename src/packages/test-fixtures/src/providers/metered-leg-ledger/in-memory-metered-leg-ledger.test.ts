import assert from "node:assert/strict";
import { initInMemoryMeteredLegLedger } from "./in-memory-metered-leg-ledger";

const URL = "https://example.com/article";
const LEG = "comprehensive" as const;

function createClock(startIso: string) {
	let nowMs = Date.parse(startIso);
	return {
		now: () => new Date(nowMs),
		advanceMinutes: (minutes: number) => {
			nowMs += minutes * 60_000;
		},
	};
}

function createLedger(options: { deferred: Set<string> } = { deferred: new Set() }) {
	const clock = createClock("2026-11-04T10:00:00.000Z");
	const ledger = initInMemoryMeteredLegLedger({
		isMeteredLegsDeferred: (url) => options.deferred.has(url),
		now: clock.now,
	});
	return { ...ledger, clock };
}

const claim = (claimId: string, inputHash = "hash-a") => ({
	url: URL,
	leg: LEG,
	inputHash,
	claimId,
	expiresAt: "2026-11-04T10:15:00.000Z",
});

async function grantedPermit(ledger: ReturnType<typeof createLedger>, claimId: string, inputHash = "hash-a") {
	const result = await ledger.claimMeteredLeg(claim(claimId, inputHash));
	assert.ok(result.kind === "granted");
	return result.permit;
}

describe("initInMemoryMeteredLegLedger", () => {
	it("grants a permit naming the leg, claim and input", async () => {
		const ledger = createLedger();

		const result = await ledger.claimMeteredLeg(claim("message-1"));

		assert.deepEqual(result, {
			kind: "granted",
			permit: { leg: LEG, claimId: "message-1", inputHash: "hash-a" },
		});
	});

	it("answers deferred while the article's metered legs are deferred", async () => {
		const ledger = createLedger({ deferred: new Set([URL]) });

		assert.deepEqual(await ledger.claimMeteredLeg(claim("message-1")), { kind: "deferred" });
	});

	it("answers in-flight while another holder's claim is live", async () => {
		const ledger = createLedger();
		await grantedPermit(ledger, "message-1");

		assert.deepEqual(await ledger.claimMeteredLeg(claim("message-2")), { kind: "in-flight" });
	});

	it("re-grants the same holder's claim on redelivery", async () => {
		const ledger = createLedger();
		await grantedPermit(ledger, "message-1");

		assert.equal((await ledger.claimMeteredLeg(claim("message-1"))).kind, "granted");
	});

	it("grants another holder once the live claim has expired", async () => {
		const ledger = createLedger();
		await grantedPermit(ledger, "message-1");
		ledger.clock.advanceMinutes(16);

		assert.equal((await ledger.claimMeteredLeg(claim("message-2"))).kind, "granted");
	});

	it("answers settled with the outcome for the same input, and grants a changed input", async () => {
		const ledger = createLedger();
		const permit = await grantedPermit(ledger, "message-1");
		await ledger.settleMeteredLeg({ url: URL, permit, outcome: "outcome-1", settledAt: "2026-11-04T10:05:00.000Z" });

		assert.deepEqual(
			await ledger.claimMeteredLeg(claim("message-2")),
			{ kind: "settled", outcome: "outcome-1" },
		);
		assert.equal((await ledger.claimMeteredLeg(claim("message-3", "hash-b"))).kind, "granted");
	});

	it("refuses to settle a claim the permit no longer holds", async () => {
		const ledger = createLedger();
		const permit = await grantedPermit(ledger, "message-1");
		await ledger.releaseMeteredLeg({ url: URL, permit });

		await expect(
			ledger.settleMeteredLeg({ url: URL, permit, outcome: "outcome-1", settledAt: "2026-11-04T10:05:00.000Z" }),
		).rejects.toThrow("not held by message-1");
	});

	it("frees the leg on release so another holder is granted", async () => {
		const ledger = createLedger();
		const permit = await grantedPermit(ledger, "message-1");

		await ledger.releaseMeteredLeg({ url: URL, permit });

		assert.equal((await ledger.claimMeteredLeg(claim("message-2"))).kind, "granted");
	});

	it("leaves another holder's claim in place when a stale permit is released", async () => {
		const ledger = createLedger();
		const stale = await grantedPermit(ledger, "message-1");
		ledger.clock.advanceMinutes(16);
		const renewed = await ledger.claimMeteredLeg({ ...claim("message-2"), expiresAt: "2026-11-04T10:31:00.000Z" });
		assert.equal(renewed.kind, "granted");

		await ledger.releaseMeteredLeg({ url: URL, permit: stale });

		assert.deepEqual(await ledger.claimMeteredLeg(claim("message-3")), { kind: "in-flight" });
	});
});
