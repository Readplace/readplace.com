import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type {
	DeleteOnboarding,
	GetOnboardingSignals,
	MarkFirstInboxEmailNoticeSent,
	NativeAppPlatform,
	RecordDeleteArticleAcknowledged,
	RecordMarkReadAcrossQueuesAcknowledged,
	RecordNativeAppAnyActivity,
	RecordNativeAppSavedArticle,
	RecordNextReadMinimumReached,
	RecordNextReadStepOutstanding,
} from "@packages/provider-contracts/onboarding-signals";

const OnboardingRow = z.object({
	userId: UserIdSchema,
	/* ISO instant of the first authenticated iOS request; absent until then. */
	iosAppActivatedAt: dynamoField(z.string()),
	/* ISO instant of the first save from the iOS app; absent until then. */
	iosAppSavedAt: dynamoField(z.string()),
	/* ISO instant of the first authenticated Android request; absent until then. */
	androidAppActivatedAt: dynamoField(z.string()),
	/* ISO instant of the first save from the Android app; absent until then. */
	androidAppSavedAt: dynamoField(z.string()),
	/* ISO instant the account's save count first reached the Next Read
	 * minimum; absent until then. */
	nextReadMinimumReachedAt: dynamoField(z.string()),
	/* ISO instant the reader was first shown the Next Read step with saves
	 * still to go; absent until then. */
	nextReadStepOutstandingAt: dynamoField(z.string()),
	markReadAcrossQueuesAckedAt: dynamoField(z.string()),
	deleteArticleAckedAt: dynamoField(z.string()),
	firstInboxEmailNoticeSentAt: dynamoField(z.string()),
});

/** The two attributes each app writes. Keyed by platform so a new native app is
 * a compile error here until it is given its own pair rather than silently
 * sharing another app's. */
const ATTRIBUTES_BY_PLATFORM = {
	ios: { activated: "iosAppActivatedAt", saved: "iosAppSavedAt" },
	android: { activated: "androidAppActivatedAt", saved: "androidAppSavedAt" },
} as const satisfies Record<NativeAppPlatform, { activated: string; saved: string }>;

/** Per-user onboarding signals on a dedicated table keyed by `userId`. The app
 * writes come from each app's authenticated requests and are read by the phone
 * browser's `/queue` render — the two share only the userId because the browser
 * can't see the app's cookies. Keyed directly by `userId` (no GSI, no users-row
 * coupling) so per-user onboarding state that is not device-scoped registers here
 * too. */
export function initOnboardingSignals(deps: {
	client: DynamoDBDocumentClient;
	onboardingTableName: string;
	now: () => Date;
}): {
	recordNativeAppAnyActivity: RecordNativeAppAnyActivity;
	recordNativeAppSavedArticle: RecordNativeAppSavedArticle;
	recordNextReadMinimumReached: RecordNextReadMinimumReached;
	recordNextReadStepOutstanding: RecordNextReadStepOutstanding;
	recordMarkReadAcrossQueuesAcknowledged: RecordMarkReadAcrossQueuesAcknowledged;
	recordDeleteArticleAcknowledged: RecordDeleteArticleAcknowledged;
	markFirstInboxEmailNoticeSent: MarkFirstInboxEmailNoticeSent;
	getOnboardingSignals: GetOnboardingSignals;
	deleteOnboarding: DeleteOnboarding;
} {
	const onboarding = defineDynamoTable({
		client: deps.client,
		tableName: deps.onboardingTableName,
		schema: OnboardingRow,
	});

	const recordNativeAppAnyActivity: RecordNativeAppAnyActivity = async ({ userId, platform }) => {
		await onboarding.update({
			Key: { userId },
			UpdateExpression: "SET #activated = if_not_exists(#activated, :now)",
			ExpressionAttributeNames: { "#activated": ATTRIBUTES_BY_PLATFORM[platform].activated },
			ExpressionAttributeValues: { ":now": deps.now().toISOString() },
		});
	};

	const recordNativeAppSavedArticle: RecordNativeAppSavedArticle = async ({ userId, platform }) => {
		await onboarding.update({
			Key: { userId },
			UpdateExpression:
				"SET #activated = if_not_exists(#activated, :now), #saved = if_not_exists(#saved, :now)",
			ExpressionAttributeNames: {
				"#activated": ATTRIBUTES_BY_PLATFORM[platform].activated,
				"#saved": ATTRIBUTES_BY_PLATFORM[platform].saved,
			},
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

	const recordNextReadStepOutstanding: RecordNextReadStepOutstanding = async ({
		userId,
	}) => {
		await onboarding.update({
			Key: { userId },
			UpdateExpression:
				"SET nextReadStepOutstandingAt = if_not_exists(nextReadStepOutstandingAt, :now)",
			ExpressionAttributeValues: { ":now": deps.now().toISOString() },
		});
	};

	const recordMarkReadAcrossQueuesAcknowledged: RecordMarkReadAcrossQueuesAcknowledged = async ({
		userId,
	}) => {
		await onboarding.update({
			Key: { userId },
			UpdateExpression:
				"SET markReadAcrossQueuesAckedAt = if_not_exists(markReadAcrossQueuesAckedAt, :now)",
			ExpressionAttributeValues: { ":now": deps.now().toISOString() },
		});
	};

	const recordDeleteArticleAcknowledged: RecordDeleteArticleAcknowledged = async ({ userId }) => {
		await onboarding.update({
			Key: { userId },
			UpdateExpression: "SET deleteArticleAckedAt = if_not_exists(deleteArticleAckedAt, :now)",
			ExpressionAttributeValues: { ":now": deps.now().toISOString() },
		});
	};

	const markFirstInboxEmailNoticeSent: MarkFirstInboxEmailNoticeSent = async ({
		userId,
		sentAt,
	}) => {
		try {
			await onboarding.update({
				Key: { userId },
				UpdateExpression: "SET firstInboxEmailNoticeSentAt = :sentAt",
				ConditionExpression: "attribute_not_exists(firstInboxEmailNoticeSentAt)",
				ExpressionAttributeValues: { ":sentAt": sentAt },
			});
			return "claimed";
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return "already-sent";
			throw error;
		}
	};

	const getOnboardingSignals: GetOnboardingSignals = async ({ userId }) => {
		const row = await onboarding.get({ userId });
		const reachedAt = row?.nextReadMinimumReachedAt;
		const outstandingAt = row?.nextReadStepOutstandingAt;
		const ackedAt = row?.markReadAcrossQueuesAckedAt;
		const deleteAckedAt = row?.deleteArticleAckedAt;
		return {
			nativeApp: {
				ios: { installed: !!row?.iosAppActivatedAt, savedArticle: !!row?.iosAppSavedAt },
				android: {
					installed: !!row?.androidAppActivatedAt,
					savedArticle: !!row?.androidAppSavedAt,
				},
			},
			nextReadMinimumReachedAt: reachedAt ? new Date(reachedAt) : undefined,
			nextReadStepOutstandingAt: outstandingAt ? new Date(outstandingAt) : undefined,
			markReadAcrossQueuesAckedAt: ackedAt ? new Date(ackedAt) : undefined,
			deleteArticleAckedAt: deleteAckedAt ? new Date(deleteAckedAt) : undefined,
		};
	};

	const deleteOnboarding: DeleteOnboarding = async ({ userId }) => {
		await onboarding.delete({ Key: { userId } });
	};

	return {
		recordNativeAppAnyActivity,
		recordNativeAppSavedArticle,
		recordNextReadMinimumReached,
		recordNextReadStepOutstanding,
		recordMarkReadAcrossQueuesAcknowledged,
		recordDeleteArticleAcknowledged,
		markFirstInboxEmailNoticeSent,
		getOnboardingSignals,
		deleteOnboarding,
	};
}
