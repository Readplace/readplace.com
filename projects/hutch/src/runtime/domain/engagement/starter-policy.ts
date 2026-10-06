import { createHash } from "node:crypto";
import { z } from "zod";
import type { UserId } from "@packages/domain/user";
import type {
	EngagementState,
	StarterAssignment,
} from "@packages/provider-contracts/engagement-starter";

export const STARTER_CAMPAIGN_ID = "hn-starter-v1";
export const STARTER_INACTIVITY_MS = 72 * 60 * 60 * 1000;
export const STARTER_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const STARTER_EMAIL_GAP_MS = 47.5 * 60 * 60 * 1000;
export const STARTER_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000 - 5 * 60 * 1000;

export const StarterRolloutSchema = z.object({
	campaignId: z.literal(STARTER_CAMPAIGN_ID),
	observationStartedAt: z.iso.datetime(),
	enrollmentStartedAt: z.iso.datetime(),
	deploymentSha: z.string(),
	excludedUserIds: z.array(z.string()),
	treatmentPercent: z.literal(80),
	personalArticleLimit: z.literal(5),
	inactivityHours: z.literal(72),
	firstReviewDay: z.literal(42),
	reviewEnrollmentDays: z.literal(28),
});
export type StarterRollout = z.infer<typeof StarterRolloutSchema>;

export function starterArm(userId: UserId): StarterAssignment["arm"] {
	const bucket =
		createHash("sha256").update(`${STARTER_CAMPAIGN_ID}/${userId}`).digest().readUInt32BE(0) % 100;
	return bucket < 80 ? "treatment" : "comparison";
}

export function hasStarterObservation(input: {
	state: EngagementState;
	registeredAt: string;
	now: Date;
}): boolean {
	if (input.state.observationStartedAt === undefined) return false;
	const inactiveSince = Math.max(
		Date.parse(input.registeredAt),
		Date.parse(input.state.observationStartedAt),
		input.state.lastActivityAt === undefined
			? Number.NEGATIVE_INFINITY
			: Date.parse(input.state.lastActivityAt),
	);
	return input.now.getTime() - inactiveSince >= STARTER_INACTIVITY_MS;
}
