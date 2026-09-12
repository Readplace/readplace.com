import { initAttributeRefreshRefusal } from "./attribute-refusal";
import { CredentialHistory } from "./evidence";
import { initEvaluateRefreshOutcomes, RefreshRefusal, TestGrantWindows } from "./outcomes";

it.each([429, 503])("excludes a designated connection's %s while monitoring ordinary connections", async status => {
	const minute = Date.parse("2026-09-12T12:00:00Z");
	const record = jest.fn().mockResolvedValue(undefined);
	const attribute = initAttributeRefreshRefusal({
		findHistory: async fingerprint => CredentialHistory.parse({
			pk: `credential#${fingerprint}`, fingerprint, grantId: fingerprint === "development" ? "test-grant" : "ordinary-grant",
			credentialExpiresAt: minute + 1000, expiresAt: minute / 1000 + 31 * 86400,
			revocation: { cause: "logout", completedAt: minute },
		}),
		record,
	});
	for (const fingerprint of ["development", "ordinary"]) {
		await attribute(RefreshRefusal.parse({ refusalId: fingerprint, occurredAt: minute - 600_000, fingerprint, status, reason: "unknown" }));
	}
	expect(record.mock.calls.map(([refusal]) => refusal)).toEqual([
		{ refusalId: "development", occurredAt: minute - 600_000, fingerprint: "development", status, reason: "unknown", grantId: "test-grant" },
		{ refusalId: "ordinary", occurredAt: minute - 600_000, fingerprint: "ordinary", status, reason: "unknown", grantId: "ordinary-grant" },
	]);
	const evaluate = initEvaluateRefreshOutcomes({
		readDay: async () => record.mock.calls.map(([refusal]) => ({ day: "2026-09-12", order: refusal.refusalId, expiresAt: minute / 1000 + 86400, refusal })),
		testGrants: TestGrantWindows.parse([{ grantId: "test-grant", from: minute - 700_000, until: minute }]),
		publish: jest.fn(),
	});
	expect(await evaluate(minute)).toEqual({ raw: 2, test: 1, expected: 0, recovered: 0, unexpected: 1, unknown: 0, pending: 0 });
});

it("keeps a credential with no history unknown and preserves existing attribution", async () => {
	const findHistory = jest.fn().mockResolvedValue(undefined);
	const record = jest.fn().mockResolvedValue(undefined);
	const attribute = initAttributeRefreshRefusal({ findHistory, record });
	const unknown = RefreshRefusal.parse({ refusalId: "unknown", occurredAt: 123, fingerprint: "unknown", status: 400, reason: "unknown" });
	const known = RefreshRefusal.parse({ ...unknown, refusalId: "known", grantId: "known-grant" });
	await attribute(unknown);
	await attribute(known);
	expect(record.mock.calls).toEqual([[unknown], [known]]);
	expect(findHistory.mock.calls).toEqual([[unknown.fingerprint]]);
});

it("retries attribution failure through the existing delivery path", async () => {
	const record = jest.fn();
	const attribute = initAttributeRefreshRefusal({ findHistory: async () => { throw new Error("history unavailable"); }, record });
	await expect(attribute(RefreshRefusal.parse({ refusalId: "attempt", occurredAt: 123, fingerprint: "fingerprint", status: 429, reason: "unknown" }))).rejects.toThrow("history unavailable");
	expect(record.mock.calls).toEqual([]);
});
