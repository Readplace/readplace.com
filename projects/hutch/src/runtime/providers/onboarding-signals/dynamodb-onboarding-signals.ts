import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type {
	DeleteOnboarding,
	GetOnboardingSignals,
	RecordIosAnyActivity,
	RecordIosSavedArticle,
	RecordNextReadMinimumReached,
} from "@packages/provider-contracts/onboarding-signals";

const OnboardingRow = z.object({
	userId: UserIdSchema,
	/* ISO instant of the first authenticated iOS request; absent until then. */
	iosAppActivatedAt: dynamoField(z.string()),
	/* ISO instant of the first save from the iOS app; absent until then. */
	iosAppSavedAt: dynamoField(z.string()),
	/* ISO instant the account's save count first reached the Next Read
	 * minimum; absent until then. */
	nextReadMinimumReachedAt: dynamoField(z.string()),
});

/** Per-user onboarding signals on a dedicated table keyed by `userId`. The iOS
 * writes come from the app's authenticated requests and are read by Safari's
 * `/queue` render — the two share only the userId because Safari can't see the
 * app's cookies. Keyed directly by `userId` (no GSI, no users-row coupling) so
 * per-user onboarding state that is not device-scoped registers here too. */
export function initOnboardingSignals(deps: {
	client: DynamoDBDocumentClient;
	onboardingTableName: string;
	now: () => Date;
}): {
	recordIosAnyActivity: RecordIosAnyActivity;
	recordIosSavedArticle: RecordIosSavedArticle;
	recordNextReadMinimumReached: RecordNextReadMinimumReached;
	getOnboardingSignals: GetOnboardingSignals;
	deleteOnboarding: DeleteOnboarding;
} {
	const onboarding = defineDynamoTable({
		client: deps.client,
		tableName: deps.onboardingTableName,
		schema: OnboardingRow,
	});

	const recordIosAnyActivity: RecordIosAnyActivity = async ({ userId }) => {
		await onboarding.update({
			Key: { userId },
			UpdateExpression: "SET iosAppActivatedAt = if_not_exists(iosAppActivatedAt, :now)",
			ExpressionAttributeValues: { ":now": deps.now().toISOString() },
		});
	};

	const recordIosSavedArticle: RecordIosSavedArticle = async ({ userId }) => {
		await onboarding.update({
			Key: { userId },
			UpdateExpression:
				"SET iosAppActivatedAt = if_not_exists(iosAppActivatedAt, :now), iosAppSavedAt = if_not_exists(iosAppSavedAt, :now)",
			ExpressionAttributeValues: { ":now": deps.now().toISOString() },
		});
	};

	const recordNextReadMinimumReached: RecordNextReadMinimumReached = async ({
		userId,
	}) => {
		await onboarding.update({
			Key: { userId },
			UpdateExpression:
				"SET nextReadMinimumReachedAt = if_not_exists(nextReadMinimumReachedAt, :now)",
			ExpressionAttributeValues: { ":now": deps.now().toISOString() },
		});
	};

	const getOnboardingSignals: GetOnboardingSignals = async ({ userId }) => {
		const row = await onboarding.get({ userId });
		const reachedAt = row?.nextReadMinimumReachedAt;
		return {
			installed: !!row?.iosAppActivatedAt,
			savedArticle: !!row?.iosAppSavedAt,
			nextReadMinimumReachedAt: reachedAt ? new Date(reachedAt) : undefined,
		};
	};

	const deleteOnboarding: DeleteOnboarding = async ({ userId }) => {
		await onboarding.delete({ Key: { userId } });
	};

	return {
		recordIosAnyActivity,
		recordIosSavedArticle,
		recordNextReadMinimumReached,
		getOnboardingSignals,
		deleteOnboarding,
	};
}
