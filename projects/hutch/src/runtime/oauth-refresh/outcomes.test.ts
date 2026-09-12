import type { z } from "zod";
import { initEvaluateRefreshOutcomes, type RefreshOutcome, RefreshRefusal, TestGrantWindows } from "./outcomes";

type RefusalInput = Partial<z.input<typeof RefreshRefusal>>;

const minute = Date.parse("2026-09-11T12:00:00Z");
function outcome(input: RefusalInput = {}, recoveredAt?: number): RefreshOutcome {
	return { day: "2026-09-11", order: "unused", expiresAt: minute / 1000 + 86400,
		refusal: RefreshRefusal.parse({ refusalId: "00000000-0000-4000-8000-000000000001", occurredAt: minute - 600_000, fingerprint: "credential", status: 400, reason: "unknown", ...input }), recoveredAt };
}

it.each([
	[{}, undefined, "unexpected"],
	[{ status: 503, occurredAt: minute - 1 }, undefined, "unexpected"],
	[{ reason: "expired", credentialExpiresAt: minute - 700_000 }, undefined, "expected"],
	[{ reason: "logout", revocation: { cause: "logout", completedAt: minute - 700_000 } }, undefined, "expected"],
	[{ reason: "logout-all", revocation: { cause: "logout-all", completedAt: minute - 700_000 } }, undefined, "expected"],
	[{ reason: "account-deletion", revocation: { cause: "account-deletion", completedAt: minute - 700_000 } }, undefined, "expected"],
	[{ reason: "rotation", revocation: { cause: "rotation", completedAt: minute - 700_000 } }, undefined, "unexpected"],
	[{ reason: "expired", credentialExpiresAt: minute + 1 }, undefined, "unexpected"],
	[{ status: 429, reason: "expired", credentialExpiresAt: 0 }, undefined, "unexpected"],
	[{}, minute - 100, "recovered"],
	[{ status: 503, occurredAt: minute - 1_000 }, minute - 100, "recovered"],
	[{ occurredAt: minute - 299_999 }, undefined, "pending"],
	[{ occurredAt: minute - 300_000 }, undefined, "unexpected"],
] satisfies [RefusalInput, number | undefined, string][])("classifies authoritative evidence %j", async (refusal, recovery, expected) => {
	const publish = jest.fn();
	const evaluate = initEvaluateRefreshOutcomes({ readDay: async () => [outcome(refusal, recovery)], testGrants: [], publish });
	const counts = await evaluate(minute);
	expect(Object.entries(counts).find(([key]) => key === expected)?.[1]).toBe(1);
	expect(counts.raw).toBe(1);
	if (expected !== "unexpected") expect(counts.unexpected).toBe(0);
	expect(publish).toHaveBeenCalledWith({ minute, counts });
});

it("designates one connection only and uses its refusal-time window", async () => {
	const rows = [outcome({ grantId: "test" }), outcome({ grantId: "ordinary", refusalId: "ordinary" }), outcome({ grantId: "test", occurredAt: minute - 800_000, refusalId: "before" })];
	const evaluate = initEvaluateRefreshOutcomes({ readDay: async () => rows, testGrants: TestGrantWindows.parse([{ grantId: "test", from: minute - 700_000, until: minute }]), publish: jest.fn() });
	expect(await evaluate(minute)).toEqual({ raw: 3, test: 1, expected: 0, recovered: 0, unexpected: 2, unknown: 0, pending: 0 });
});

it("ignores recovery-only records, out-of-window failures and duplicate delivery", async () => {
	const rows = [outcome(), outcome(), outcome({ occurredAt: minute - 86400_001, refusalId: "old" }), outcome({ occurredAt: minute + 1, refusalId: "future" }), { day: "2026-09-11", order: "recovery", expiresAt: 1, recoveredAt: minute }];
	const readDay = jest.fn(async () => rows);
	const evaluate = initEvaluateRefreshOutcomes({ readDay, testGrants: [], publish: jest.fn() });
	expect((await evaluate(minute)).unexpected).toBe(1);
	expect(readDay.mock.calls).toHaveLength(2);
});

it("does not publish zero when a day query fails", async () => {
	const publish = jest.fn();
	const evaluate = initEvaluateRefreshOutcomes({ readDay: async () => { throw new Error("query failed"); }, testGrants: [], publish });
	await expect(evaluate(minute)).rejects.toThrow("query failed");
	expect(publish.mock.calls).toEqual([]);
});

it("pins delayed evaluations to the scheduled minute", async () => {
	const publish = jest.fn();
	const evaluate = initEvaluateRefreshOutcomes({ readDay: async () => [], testGrants: [], publish });
	await evaluate(minute + 12_345);
	expect(publish.mock.calls[0][0].minute).toBe(minute);
});
