import assert from "node:assert";
import { GetObjectCommand, PutObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import {
	StarterRolloutSchema,
	STARTER_CAMPAIGN_ID,
	STARTER_INACTIVITY_MS,
	type StarterRollout,
} from "../../domain/engagement/starter-policy";

export function initS3StarterRollout(deps: {
	bucketName: string;
	get: (
		command: GetObjectCommand,
	) => Promise<{ Body?: { transformToString: (encoding: string) => Promise<string> } }>;
	put: (command: PutObjectCommand) => Promise<unknown>;
}) {
	const key = `engagement-starter/${STARTER_CAMPAIGN_ID}/rollout.json`;
	const findRollout = async (): Promise<StarterRollout | undefined> => {
		try {
			const response = await deps.get(new GetObjectCommand({ Bucket: deps.bucketName, Key: key }));
			assert(response.Body, "rollout record has a body");
			return StarterRolloutSchema.parse(JSON.parse(await response.Body.transformToString("utf-8")));
		} catch (error) {
			if (error instanceof NoSuchKey) return undefined;
			throw error;
		}
	};
	const startObservation = async (input: {
		now: Date;
		deploymentSha: string;
		excludedUserIds: string[];
	}): Promise<StarterRollout> => {
		const existing = await findRollout();
		if (existing !== undefined) return existing;
		const rollout: StarterRollout = {
			campaignId: STARTER_CAMPAIGN_ID,
			observationStartedAt: input.now.toISOString(),
			enrollmentStartedAt: new Date(input.now.getTime() + STARTER_INACTIVITY_MS).toISOString(),
			deploymentSha: input.deploymentSha,
			excludedUserIds: input.excludedUserIds,
			treatmentPercent: 80,
			personalArticleLimit: 5,
			inactivityHours: 72,
			firstReviewDay: 42,
			reviewEnrollmentDays: 28,
		};
		try {
			await deps.put(
				new PutObjectCommand({
					Bucket: deps.bucketName,
					Key: key,
					Body: JSON.stringify(rollout),
					ContentType: "application/json",
					IfNoneMatch: "*",
				}),
			);
			return rollout;
		} catch (error) {
			if (!(error instanceof Error) || error.name !== "PreconditionFailed") throw error;
			const winner = await findRollout();
			assert(winner, "the competing deployment recorded the rollout");
			return winner;
		}
	};
	return { findRollout, startObservation };
}
