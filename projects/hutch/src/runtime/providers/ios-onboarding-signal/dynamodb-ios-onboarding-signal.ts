import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type {
	DeleteOnboarding,
	GetIosAppSignals,
	RecordIosAnyActivity,
	RecordIosSavedArticle,
} from "@packages/provider-contracts/ios-onboarding-signal";

const IosOnboardingRow = z.object({
	userId: UserIdSchema,
	/* ISO instant of the first authenticated iOS request; absent until then. */
	iosAppActivatedAt: dynamoField(z.string()),
	/* ISO instant of the first save from the iOS app; absent until then. */
	iosAppSavedAt: dynamoField(z.string()),
});

/** Per-user iOS onboarding signals on a dedicated table keyed by `userId`.
 * Writes come from the app's authenticated requests; reads from Safari's
 * `/queue` render — the two share only the userId because Safari can't see the
 * app's cookies. Keyed directly by `userId` (no GSI, no users-row coupling) so
 * future per-user onboarding state can register here too. */
export function initIosOnboardingSignal(deps: {
	client: DynamoDBDocumentClient;
	onboardingTableName: string;
	now: () => Date;
}): {
	recordIosAnyActivity: RecordIosAnyActivity;
	recordIosSavedArticle: RecordIosSavedArticle;
	getIosAppSignals: GetIosAppSignals;
	deleteOnboarding: DeleteOnboarding;
} {
	const onboarding = defineDynamoTable({
		client: deps.client,
		tableName: deps.onboardingTableName,
		schema: IosOnboardingRow,
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

	const getIosAppSignals: GetIosAppSignals = async ({ userId }) => {
		const row = await onboarding.get({ userId });
		return { installed: !!row?.iosAppActivatedAt, savedArticle: !!row?.iosAppSavedAt };
	};

	const deleteOnboarding: DeleteOnboarding = async ({ userId }) => {
		await onboarding.delete({ Key: { userId } });
	};

	return { recordIosAnyActivity, recordIosSavedArticle, getIosAppSignals, deleteOnboarding };
}
