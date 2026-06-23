import assert from "node:assert";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import type {
	GetIosAppSignals,
	RecordIosAppActivity,
} from "@packages/provider-contracts/ios-onboarding-signal";

const IosOnboardingRow = z.object({
	email: z.string(),
	userId: UserIdSchema,
	/* ISO instant of the first authenticated iOS request; absent until then. */
	iosAppActivatedAt: dynamoField(z.string()),
	/* ISO instant of the first save from the iOS app; absent until then. */
	iosAppSavedAt: dynamoField(z.string()),
});

/** Per-user iOS onboarding signals stored on the existing users table (hash key
 * `email`, `userId-index` GSI projecting ALL). Writes from the app's
 * authenticated requests; reads from Safari's `/queue` render — the two share
 * only the userId because Safari can't see the app's cookies. */
export function initIosOnboardingSignal(deps: {
	client: DynamoDBDocumentClient;
	usersTableName: string;
	now: () => Date;
}): {
	recordIosAppActivity: RecordIosAppActivity;
	getIosAppSignals: GetIosAppSignals;
} {
	const users = defineDynamoTable({
		client: deps.client,
		tableName: deps.usersTableName,
		schema: IosOnboardingRow,
	});

	const findRow = async (userId: UserId) => {
		const { items } = await users.query({
			IndexName: "userId-index",
			KeyConditionExpression: "userId = :userId",
			ExpressionAttributeValues: { ":userId": userId },
			Limit: 1,
		});
		return items[0];
	};

	const recordIosAppActivity: RecordIosAppActivity = async ({ userId, savedArticle }) => {
		const row = await findRow(userId);
		assert(row, "recordIosAppActivity: no user row for an authenticated userId");
		const saveClause = savedArticle
			? ", iosAppSavedAt = if_not_exists(iosAppSavedAt, :now)"
			: "";
		await users.update({
			Key: { email: row.email },
			UpdateExpression: `SET iosAppActivatedAt = if_not_exists(iosAppActivatedAt, :now)${saveClause}`,
			ExpressionAttributeValues: { ":now": deps.now().toISOString() },
		});
	};

	const getIosAppSignals: GetIosAppSignals = async ({ userId }) => {
		const row = await findRow(userId);
		return { installed: !!row?.iosAppActivatedAt, savedArticle: !!row?.iosAppSavedAt };
	};

	return { recordIosAppActivity, getIosAppSignals };
}
