import assert from "node:assert/strict";
import { classifyRefusedClaim } from "./classify-refused-claim";

const CLAIM = { leg: "comprehensive" as const, hash: "hash-a" };

function ledgerEntry(inputHash: string) {
	return {
		M: {
			inputHash: { S: inputHash },
			outcome: { S: '{"id":"c1","tier":"tier-1"}' },
			settledAt: { S: "2026-11-04T00:00:00.000Z" },
		},
	};
}

describe("classifyRefusedClaim", () => {
	it("answers deferred when the row carries the deferral marker, even with a matching ledger entry", () => {
		const result = classifyRefusedClaim(
			{
				meteredLegsDeferredSince: { S: "2026-11-04T00:00:00.000Z" },
				ledger_comprehensive: ledgerEntry("hash-a"),
			},
			CLAIM,
		);

		assert.deepEqual(result, { kind: "deferred" });
	});

	it("answers settled with the recorded outcome when the leg's entry has the same input hash", () => {
		const result = classifyRefusedClaim({ ledger_comprehensive: ledgerEntry("hash-a") }, CLAIM);

		assert.deepEqual(result, { kind: "settled", outcome: '{"id":"c1","tier":"tier-1"}' });
	});

	it("answers in-flight when the leg's entry was settled for a different input hash", () => {
		const result = classifyRefusedClaim({ ledger_comprehensive: ledgerEntry("hash-b") }, CLAIM);

		assert.deepEqual(result, { kind: "in-flight" });
	});

	it("answers in-flight when only another leg holds a matching entry", () => {
		const result = classifyRefusedClaim({ ledger_summary: ledgerEntry("hash-a") }, CLAIM);

		assert.deepEqual(result, { kind: "in-flight" });
	});

	it("answers in-flight when the refusal returned no old item", () => {
		assert.deepEqual(classifyRefusedClaim(undefined, CLAIM), { kind: "in-flight" });
	});
});
