/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { z } from "zod";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { UserIdSchema } from "../../domain/user/user.schema";
import type {
	FindCompletedOnboardingSteps,
	MarkOnboardingStepCompleted,
	OnboardingStepId,
} from "./onboarding.types";

const OnboardingRowSchema = z.object({
	userId: UserIdSchema,
	"install-extension": z.string().optional(),
	"save-via-extension": z.string().optional(),
});

type AssertExhaustive<U, Tuple extends readonly U[]> =
	[Exclude<U, Tuple[number]>] extends [never] ? Tuple : ['missing keys', Exclude<U, Tuple[number]>];

const ALL_STEP_IDS = [
	"install-extension",
	"save-via-extension",
] as const satisfies AssertExhaustive<OnboardingStepId, readonly OnboardingStepId[]>;

export function initDynamoDbOnboarding(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	findCompletedOnboardingSteps: FindCompletedOnboardingSteps;
	markOnboardingStepCompleted: MarkOnboardingStepCompleted;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: OnboardingRowSchema,
	});

	const findCompletedOnboardingSteps: FindCompletedOnboardingSteps = async ({ userId }) => {
		const row = await table.get({ userId });
		const completed = new Set<OnboardingStepId>();
		if (!row) return completed;
		for (const stepId of ALL_STEP_IDS) {
			if (row[stepId]) completed.add(stepId);
		}
		return completed;
	};

	const markOnboardingStepCompleted: MarkOnboardingStepCompleted = async ({ userId, stepId, completedAt }) => {
		await table.update({
			Key: { userId },
			UpdateExpression: "SET #step = if_not_exists(#step, :ts)",
			ExpressionAttributeNames: { "#step": stepId },
			ExpressionAttributeValues: { ":ts": completedAt.toISOString() },
		});
	};

	return { findCompletedOnboardingSteps, markOnboardingStepCompleted };
}
/* c8 ignore stop */
