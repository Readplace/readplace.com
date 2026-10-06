import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import type {
	StarterAssignment,
	StarterPack,
} from "@packages/provider-contracts/engagement-starter";
import { initStarterReport } from "./starter-report";
import type { StarterRollout } from "./starter-policy";

const START = new Date("2026-10-10T12:00:00.000Z");
const DAY = 86_400_000;
const rollout: StarterRollout = {
	campaignId: "hn-starter-v1",
	observationStartedAt: "2026-10-07T12:00:00.000Z",
	enrollmentStartedAt: START.toISOString(),
	deploymentSha: "sha",
	excludedUserIds: [],
	treatmentPercent: 80,
	personalArticleLimit: 5,
	inactivityHours: 72,
	firstReviewDay: 42,
	reviewEnrollmentDays: 28,
};
type Observation = Awaited<
	ReturnType<Parameters<typeof initStarterReport>[0]["listAccounts"]>
>[number];
let sequence = 0;
function account(input: {
	arm: "treatment" | "comparison";
	activated?: boolean;
	days?: number;
	tier?: "trial" | "paid";
	cohort?: "new" | "existing";
	status?: StarterPack["emailStatus"];
}): Observation {
	const assignedAt = new Date(START.getTime() + (input.days ?? 0) * DAY).toISOString();
	const assignment: StarterAssignment = {
		campaignId: rollout.campaignId,
		arm: input.arm,
		assignedAt,
		tier: input.tier ?? "trial",
		accountCohort: input.cohort ?? "existing",
	};
	return {
		userId: UserIdSchema.parse(`${input.arm}-${sequence++}`),
		engagement: {
			activityRevision: 1,
			assignment,
			activatedAt: input.activated ? assignedAt : undefined,
			engagedDays8To14At: input.activated
				? new Date(Date.parse(assignedAt) + 8 * DAY).toISOString()
				: undefined,
		},
		starterPack: input.status
			? {
					campaignId: rollout.campaignId,
					picks: [],
					readlist: ReadlistSlugSchema.parse("picks"),
					readlistLabel: "Picks",
					selectedAt: assignedAt,
					insertedAt: assignedAt,
					emailStatus: input.status,
				}
			: undefined,
	};
}
async function report(accounts: Observation[], days = 42) {
	const result = await initStarterReport({
		findRollout: async () => rollout,
		listAccounts: async () => accounts,
		now: () => new Date(START.getTime() + days * DAY),
	})();
	assert(result, "a recorded rollout always yields a report");
	return result;
}

describe("intent-to-treat review", () => {
	it("reports nothing before the rollout is recorded, then reads the recorded campaign's accounts", async () => {
		const listed: string[] = [];
		const rollouts: Array<StarterRollout | undefined> = [undefined, rollout];
		const review = initStarterReport({
			findRollout: async () => rollouts.shift(),
			listAccounts: async (campaignId) => {
				listed.push(campaignId);
				return [];
			},
			now: () => START,
		});
		expect(await review()).toBeUndefined();
		expect(listed).toEqual([]);
		expect((await review())?.campaignId).toBe(rollout.campaignId);
		expect(listed).toEqual([rollout.campaignId]);
	});
	it("reports empty data as inconclusive", async () => {
		const result = await report([]);
		expect(result.formalReviewDue).toBe(true);
		expect(result.conclusion).toBe("inconclusive");
		expect(result.differenceInterval).toEqual([-1, 1]);
		expect(result.twoSidedFisherPValue).toBe(1);
	});
	it("counts each assigned account once, including immature operational failures", async () => {
		const mature = account({ arm: "treatment", activated: true });
		const immature = account({ arm: "treatment", days: 27, status: "pending" });
		assert(immature.starterPack);
		delete immature.starterPack.insertedAt;
		immature.starterPack.insertionOutcome = "failed";
		const conflict = account({ arm: "treatment", status: "pending" });
		assert(conflict.starterPack);
		delete conflict.starterPack.insertedAt;
		conflict.starterPack.insertionOutcome = "conflict";
		const result = await report([mature, mature, immature, conflict], 30);
		expect(result.arms.treatment).toMatchObject({
			assigned: 3,
			activated: 1,
			mature: 2,
			immature: 1,
			insertionFailed: 2,
			inserted: 0,
		});
	});
	it("retains failures in their arm, separates immature and tier/account cohorts, and excludes later enrollment", async () => {
		const other = account({ arm: "treatment" });
		assert(other.engagement.assignment);
		other.engagement.assignment.campaignId = "another";
		const result = await report(
			[
				account({ arm: "treatment", activated: true, status: "sent" }),
				account({ arm: "treatment" }),
				account({ arm: "treatment", status: "review", tier: "paid", cohort: "new" }),
				account({ arm: "comparison", activated: true }),
				account({ arm: "treatment", status: "suppressed" }),
				account({ arm: "comparison", days: 27 }),
				account({ arm: "treatment", days: 28 }),
				account({ arm: "comparison", days: -1 }),
				{ userId: UserIdSchema.parse("unassigned"), engagement: { activityRevision: 0 } },
				other,
			],
			30,
		);
		expect(result.arms.treatment).toMatchObject({
			assigned: 4,
			mature: 4,
			activated: 1,
			inserted: 3,
			sent: 1,
			suppressed: 1,
			review: 1,
			engagedDays8To14: 1,
		});
		expect(result.arms.comparison).toMatchObject({
			assigned: 2,
			mature: 1,
			immature: 1,
			activated: 1,
		});
		expect(result.cohorts["paid/new"]?.treatment.assigned).toBe(1);
		expect(result.absoluteActivationDifference).toBe(-0.75);
		expect(result.conclusion).toBe("inconclusive");
		expect(result.formalReviewDue).toBe(false);
	});
	it("uses a two-sided Fisher test and 95% intervals on the first twenty-eight enrollment days", async () => {
		const accounts = [
			...Array.from({ length: 20 }, () => account({ arm: "treatment", activated: true })),
			...Array.from({ length: 20 }, () => account({ arm: "comparison" })),
		];
		const result = await report(accounts);
		expect(result.absoluteActivationDifference).toBe(1);
		expect(result.twoSidedFisherPValue).toBeCloseTo(2 / 137846528820, 12);
		expect(result.differenceInterval[0]).toBeCloseTo(0.7721, 4);
		expect(result.differenceInterval[1]).toBeCloseTo(1, 4);
		expect(result.conclusion).toBe("higher-activation");
		expect((await report(accounts, 41)).conclusion).toBe("inconclusive");
		const reversed = accounts.map((item): Observation => {
			assert(item.engagement.assignment);
			return {
				...item,
				engagement: {
					...item.engagement,
					assignment: {
						...item.engagement.assignment,
						arm: item.engagement.assignment.arm === "treatment" ? "comparison" : "treatment",
					},
				},
			};
		});
		expect((await report(reversed)).conclusion).toBe("lower-activation");
	});
	it("matches Newcombe's published Wilson-score difference interval", async () => {
		const result = await report([
			...Array.from({ length: 70 }, (_, i) => account({ arm: "treatment", activated: i < 56 })),
			...Array.from({ length: 80 }, (_, i) => account({ arm: "comparison", activated: i < 48 })),
		]);
		expect(result.intervals.treatment[0]).toBeCloseTo(0.6918, 3);
		expect(result.intervals.treatment[1]).toBeCloseTo(0.877, 3);
		expect(result.intervals.comparison[0]).toBeCloseTo(0.4905, 3);
		expect(result.intervals.comparison[1]).toBeCloseTo(0.7004, 3);
		expect(result.differenceInterval[0]).toBeCloseTo(0.0524, 4);
		expect(result.differenceInterval[1]).toBeCloseTo(0.3339, 4);
	});
	it("stays inconclusive when Fisher's test passes but the difference interval still spans zero", async () => {
		const result = await report([
			...Array.from({ length: 184 }, (_, i) => account({ arm: "treatment", activated: i < 17 })),
			...Array.from({ length: 38 }, () => account({ arm: "comparison" })),
		]);
		expect(result.twoSidedFisherPValue).toBeCloseTo(0.0491, 4);
		expect(result.differenceInterval[0]).toBeCloseTo(-0.0055, 4);
		expect(result.conclusion).toBe("inconclusive");
	});
	it("preserves an inconclusive conclusion with insufficient or balanced evidence", async () => {
		expect(
			(await report([account({ arm: "treatment" }), account({ arm: "comparison" })])).conclusion,
		).toBe("inconclusive");
		expect((await report([account({ arm: "comparison", activated: true })])).conclusion).toBe(
			"inconclusive",
		);
	});
});
