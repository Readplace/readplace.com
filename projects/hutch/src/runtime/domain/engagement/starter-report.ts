import type { UserId } from "@packages/domain/user";
import type { EngagementState, StarterPack } from "@packages/provider-contracts/engagement-starter";
import type { StarterRollout } from "./starter-policy";

export type StarterReport = NonNullable<Awaited<ReturnType<ReturnType<typeof initStarterReport>>>>;

interface AccountObservation {
	userId: UserId;
	engagement: EngagementState;
	starterPack?: StarterPack;
}
export interface ArmCounts {
	assigned: number;
	mature: number;
	immature: number;
	activated: number;
	inserted: number;
	insertionFailed: number;
	sent: number;
	suppressed: number;
	review: number;
	engagedDays8To14: number;
}
const DAY_MS = 86_400_000;

function wilson(input: { successes: number; total: number }): [number, number] {
	if (input.total === 0) return [0, 1];
	const z = 1.959963984540054;
	const p = input.successes / input.total;
	const denominator = 1 + (z * z) / input.total;
	const middle = (p + (z * z) / (2 * input.total)) / denominator;
	const half =
		(z * Math.sqrt((p * (1 - p)) / input.total + (z * z) / (4 * input.total * input.total))) /
		denominator;
	return [Math.max(0, middle - half), Math.min(1, middle + half)];
}

function logChoose(input: { n: number; k: number }): number {
	let value = 0;
	const k = Math.min(input.k, input.n - input.k);
	for (let i = 1; i <= k; i++) value += Math.log(input.n - k + i) - Math.log(i);
	return value;
}

function fisher(input: { treatment: ArmCounts; comparison: ArmCounts }): number {
	const treatmentN = input.treatment.mature;
	const comparisonN = input.comparison.mature;
	const successes = input.treatment.activated + input.comparison.activated;
	const logProbability = (k: number) =>
		logChoose({ n: treatmentN, k }) +
		logChoose({ n: comparisonN, k: successes - k }) -
		logChoose({ n: treatmentN + comparisonN, k: successes });
	const observed = logProbability(input.treatment.activated);
	let p = 0;
	for (let k = Math.max(0, successes - comparisonN); k <= Math.min(successes, treatmentN); k++) {
		const probability = logProbability(k);
		if (probability <= observed + 1e-12) p += Math.exp(probability);
	}
	return Math.min(1, p);
}

function emptyCounts(): ArmCounts {
	return {
		assigned: 0,
		mature: 0,
		immature: 0,
		activated: 0,
		inserted: 0,
		insertionFailed: 0,
		sent: 0,
		suppressed: 0,
		review: 0,
		engagedDays8To14: 0,
	};
}

export function initStarterReport(deps: {
	findRollout: () => Promise<StarterRollout | undefined>;
	listAccounts: (campaignId: string) => Promise<AccountObservation[]>;
	now: () => Date;
}) {
	return async () => {
		const rollout = await deps.findRollout();
		if (rollout === undefined) return undefined;
		const now = deps.now().getTime();
		const enrollmentStart = Date.parse(rollout.enrollmentStartedAt);
		const enrollmentEnd = enrollmentStart + 28 * DAY_MS;
		const arms = { treatment: emptyCounts(), comparison: emptyCounts() };
		const cohorts = new Map<string, { treatment: ArmCounts; comparison: ArmCounts }>();
		const counted = new Set<UserId>();
		for (const account of await deps.listAccounts(rollout.campaignId)) {
			const assignment = account.engagement.assignment;
			if (
				assignment === undefined ||
				assignment.campaignId !== rollout.campaignId ||
				Date.parse(assignment.assignedAt) < enrollmentStart ||
				Date.parse(assignment.assignedAt) >= enrollmentEnd
			) {
				continue;
			}
			if (counted.has(account.userId)) continue;
			counted.add(account.userId);
			const cohortKey = `${assignment.tier}/${assignment.accountCohort}`;
			let cohort = cohorts.get(cohortKey);
			if (cohort === undefined) {
				cohort = { treatment: emptyCounts(), comparison: emptyCounts() };
				cohorts.set(cohortKey, cohort);
			}
			for (const counts of [arms[assignment.arm], cohort[assignment.arm]]) {
				counts.assigned++;
				if (
					account.starterPack?.insertionOutcome === "failed" ||
					account.starterPack?.insertionOutcome === "conflict"
				) {
					counts.insertionFailed++;
				}
				if (account.starterPack?.insertedAt !== undefined) counts.inserted++;
				if (account.starterPack?.emailStatus === "sent") counts.sent++;
				if (account.starterPack?.emailStatus === "suppressed") counts.suppressed++;
				if (account.starterPack?.emailStatus === "review") counts.review++;
				if (now - Date.parse(assignment.assignedAt) < 7 * DAY_MS) {
					counts.immature++;
					continue;
				}
				counts.mature++;
				if (account.engagement.activatedAt !== undefined) counts.activated++;
				if (
					now - Date.parse(assignment.assignedAt) >= 14 * DAY_MS &&
					account.engagement.engagedDays8To14At !== undefined
				) {
					counts.engagedDays8To14++;
				}
			}
		}
		const intervals = {
			treatment: wilson({ successes: arms.treatment.activated, total: arms.treatment.mature }),
			comparison: wilson({ successes: arms.comparison.activated, total: arms.comparison.mature }),
		};
		const haveBothArms = arms.treatment.mature > 0 && arms.comparison.mature > 0;
		const treatmentRate =
			arms.treatment.mature === 0 ? 0 : arms.treatment.activated / arms.treatment.mature;
		const comparisonRate =
			arms.comparison.mature === 0 ? 0 : arms.comparison.activated / arms.comparison.mature;
		const difference = treatmentRate - comparisonRate;
		const differenceInterval: [number, number] = haveBothArms
			? [
					difference -
						Math.hypot(
							treatmentRate - intervals.treatment[0],
							intervals.comparison[1] - comparisonRate,
						),
					difference +
						Math.hypot(
							intervals.treatment[1] - treatmentRate,
							comparisonRate - intervals.comparison[0],
						),
				]
			: [-1, 1];
		const pValue = haveBothArms ? fisher(arms) : 1;
		const formalReviewDue = now >= enrollmentStart + 42 * DAY_MS;
		const conclusion =
			formalReviewDue &&
			haveBothArms &&
			pValue < 0.05 &&
			(differenceInterval[0] > 0 || differenceInterval[1] < 0)
				? difference > 0
					? "higher-activation"
					: "lower-activation"
				: "inconclusive";
		return {
			campaignId: rollout.campaignId,
			formalReviewDue,
			enrollmentStart: rollout.enrollmentStartedAt,
			enrollmentEnd: new Date(enrollmentEnd).toISOString(),
			arms,
			cohorts: Object.fromEntries(cohorts),
			intervals,
			absoluteActivationDifference: difference,
			differenceInterval,
			intervalMethod: "Wilson/Newcombe 95%",
			twoSidedFisherPValue: pValue,
			significanceLevel: 0.05,
			conclusion,
		};
	};
}
