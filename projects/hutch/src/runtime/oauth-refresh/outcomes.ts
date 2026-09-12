import { z } from "zod";
import type { OAuthRefreshEvaluatedEvent } from "@packages/hutch-infra-components";
import { OAuthGrantId, RefreshAttempt } from "./evidence";

export type RefreshCounts = z.infer<typeof OAuthRefreshEvaluatedEvent.detailSchema>["counts"];

export const RefreshRefusal = RefreshAttempt.extend({
	status: z.number().int(),
	reason: z.string(),
	grantId: OAuthGrantId.optional(),
	credentialExpiresAt: z.number().optional(),
	revocation: z.object({ cause: z.enum(["rotation", "logout", "logout-all", "account-deletion"]), completedAt: z.number() }).optional(),
});
export type RefreshRefusal = z.infer<typeof RefreshRefusal>;
export const RefreshOutcome = z.object({
	day: z.string(),
	order: z.string(),
	expiresAt: z.number(),
	refusal: RefreshRefusal.optional(),
	recoveredAt: z.number().optional(),
});
export type RefreshOutcome = z.infer<typeof RefreshOutcome>;
export const TestGrantWindows = z.array(z.object({ grantId: OAuthGrantId, from: z.number(), until: z.number() }));
export type TestGrantWindows = z.infer<typeof TestGrantWindows>;

export function initEvaluateRefreshOutcomes(deps: {
	readDay: (input: { day: string; from: number; until: number }) => Promise<RefreshOutcome[]>;
	testGrants: TestGrantWindows;
	publish: (input: { minute: number; counts: RefreshCounts }) => Promise<void>;
}) {
	return async (at: number) => {
		const minute = Math.floor(at / 60_000) * 60_000;
		const from = minute - 86_400_000;
		const days = [...new Set([new Date(from).toISOString().slice(0, 10), new Date(minute).toISOString().slice(0, 10)])];
		const rows = (await Promise.all(days.map(day => deps.readDay({ day, from, until: minute })))).flat();
		const counts = { raw: 0, test: 0, expected: 0, recovered: 0, unexpected: 0, unknown: 0, pending: 0 };
		const seen = new Set<string>();
		for (const row of rows) {
			const refusal = row.refusal;
			if (!refusal || refusal.occurredAt < from || refusal.occurredAt > minute || seen.has(refusal.refusalId)) continue;
			seen.add(refusal.refusalId);
			counts.raw++;
			if (deps.testGrants.some(grant => grant.grantId === refusal.grantId && grant.from <= refusal.occurredAt && refusal.occurredAt < grant.until)) { counts.test++; continue; }
			if (refusal.status === 400 && (refusal.reason === "expired" && refusal.credentialExpiresAt !== undefined && refusal.credentialExpiresAt <= refusal.occurredAt || refusal.revocation && refusal.reason === refusal.revocation.cause && refusal.revocation.cause !== "rotation" && refusal.revocation.completedAt <= refusal.occurredAt)) { counts.expected++; continue; }
			if (row.recoveredAt !== undefined) { counts.recovered++; continue; }
			if (!refusal.grantId) counts.unknown++;
			if (refusal.status >= 500) { counts.unexpected++; continue; }
			if (refusal.occurredAt > minute - 300_000) { counts.pending++; continue; }
			counts.unexpected++;
		}
		await deps.publish({ minute, counts });
		return counts;
	};
}
