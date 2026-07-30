import { type DynamoDBDocumentClient, defineDynamoTable } from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type {
	DeleteReadingPreference,
	GetReadingPreference,
	SaveReadingPreference,
} from "@packages/provider-contracts/reading-preference";

const ReadingPreferenceRow = z.object({
	userId: UserIdSchema,
	preferenceText: z.string(),
	updatedAt: z.string(),
});

export function initReadingPreference(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): {
	saveReadingPreference: SaveReadingPreference;
	getReadingPreference: GetReadingPreference;
	deleteReadingPreference: DeleteReadingPreference;
} {
	const preferences = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: ReadingPreferenceRow,
	});

	const saveReadingPreference: SaveReadingPreference = async ({ userId, text }) => {
		await preferences.put({
			Item: { userId, preferenceText: text, updatedAt: deps.now().toISOString() },
		});
	};

	const getReadingPreference: GetReadingPreference = async ({ userId }) => {
		const row = await preferences.get({ userId });
		if (!row) return undefined;
		return { text: row.preferenceText, updatedAt: row.updatedAt };
	};

	const deleteReadingPreference: DeleteReadingPreference = async ({ userId }) => {
		await preferences.delete({ Key: { userId } });
	};

	return { saveReadingPreference, getReadingPreference, deleteReadingPreference };
}
