import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	batchGetFromTable,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import {
	type InboxLinkSaveState,
	type InboxSavedLinkStore,
	inboxSavedLinkKey,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";

const InboxSavedLinkRow = z.object({
	userId: UserIdSchema,
	linkKey: z.string(),
	state: z.enum(["saved", "failed"]),
	updatedAt: z.string(),
	/** The key is a hash, so the row carries the URL it stands for — otherwise a
	 * row in the console names nothing. Never read back for matching. */
	url: dynamoField(z.string()),
});

/** Pairs each caller url with its key, dropping the ones that are not URLs at
 * all. A card's stored url comes from an email body, so a malformed one is a
 * data problem for that link, never a reason to fail the page's whole lookup. */
function toKeyedUrls(urls: readonly string[]): Array<{ url: string; linkKey: string }> {
	const keyed: Array<{ url: string; linkKey: string }> = [];
	for (const url of urls) {
		try {
			keyed.push({ url, linkKey: inboxSavedLinkKey(url) });
		} catch {
			continue;
		}
	}
	return keyed;
}

export function initDynamoDbInboxSavedLink(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): InboxSavedLinkStore {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: InboxSavedLinkRow,
	});

	const putState = async (input: {
		userId: string;
		url: string;
		state: InboxLinkSaveState;
		/** Only a failure needs guarding — see markLinkSaveFailed's contract. */
		onlyIfNotSaved?: boolean;
	}): Promise<void> => {
		const put = {
			Item: {
				userId: input.userId,
				linkKey: inboxSavedLinkKey(input.url),
				state: input.state,
				updatedAt: deps.now().toISOString(),
				url: input.url,
			},
		};
		if (input.onlyIfNotSaved !== true) {
			await table.put(put);
			return;
		}
		try {
			await table.put({
				...put,
				ConditionExpression: "attribute_not_exists(linkKey) OR #state <> :saved",
				ExpressionAttributeNames: { "#state": "state" },
				ExpressionAttributeValues: { ":saved": "saved" },
			});
		} catch (error) {
			// The link is already recorded as saved, which outranks the failure.
			if (error instanceof ConditionalCheckFailedException) return;
			throw error;
		}
	};

	return {
		markLinkSaved: ({ userId, url }) => putState({ userId, url, state: "saved" }),
		markLinkSaveFailed: ({ userId, url }) =>
			putState({ userId, url, state: "failed", onlyIfNotSaved: true }),
		findSavedLinks: async ({ userId, urls }) => {
			const keyed = toKeyedUrls(urls);
			const uniqueKeys = [...new Set(keyed.map((entry) => entry.linkKey))];
			const rows = await batchGetFromTable({
				client: deps.client,
				tableName: deps.tableName,
				schema: InboxSavedLinkRow,
				keys: uniqueKeys.map((linkKey) => ({ userId, linkKey })),
			});
			const byKey = new Map(rows.map((row) => [row.linkKey, row.state]));
			const byUrl = new Map<string, InboxLinkSaveState>();
			for (const entry of keyed) {
				const state = byKey.get(entry.linkKey);
				if (state !== undefined) byUrl.set(entry.url, state);
			}
			return byUrl;
		},
		deleteAllByUserId: async (userId) => {
			await forEachQueryPage(
				table,
				{
					KeyConditionExpression: "userId = :u",
					ExpressionAttributeValues: { ":u": userId },
				},
				async (rows) => {
					await Promise.all(
						rows.map((row) =>
							table.delete({ Key: { userId: row.userId, linkKey: row.linkKey } }),
						),
					);
				},
			);
		},
	};
}
