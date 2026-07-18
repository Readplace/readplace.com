import assert from "node:assert";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import {
	EmailLinkOrdinalSchema,
	EmailLinkSkipReasonSchema,
	EmailLinkStatusSchema,
	type InboxEmailLinkEntry,
	type InboxEmailLinkStore,
	type InboxEmailLinksMeta,
} from "@packages/domain/inbox";
import { type UserId, UserIdSchema } from "@packages/domain/user";

/** Sort key of the per-email meta item co-located in the links partition. Holds
 * only `truncated`. `^\d{4}$` ordinals sort before `"meta"` lexicographically, so
 * the meta item trails the link rows in a single ascending Query. */
const META_SORT_KEY = "meta";

/** One partition per email so every link (and the meta item) returns from a
 * single Query. `receivedAtMessageId` already embeds the message id, so the
 * composite is unique per email. */
function groupKey(input: { userId: UserId; receivedAtMessageId: string }): string {
	return `${input.userId}#${input.receivedAtMessageId}`;
}

/** A single row schema serves both the link rows and the reserved meta item: the
 * link-only and meta-only columns are all optional (`dynamoField`), and the
 * `ordinal` sort key distinguishes them on read. defineDynamoTable parses every
 * queried item through one ZodObject, so a union schema is not an option. */
const InboxEmailLinkRow = z.object({
	userLinkGroup: z.string(),
	ordinal: z.string(),
	userId: UserIdSchema,
	receivedAtMessageId: z.string(),
	url: dynamoField(z.string()),
	resolvedUrl: dynamoField(z.string()),
	status: dynamoField(EmailLinkStatusSchema),
	title: dynamoField(z.string()),
	excerpt: dynamoField(z.string()),
	siteName: dynamoField(z.string()),
	imageUrl: dynamoField(z.string()),
	failureReason: dynamoField(z.string()),
	skipReason: dynamoField(EmailLinkSkipReasonSchema),
	truncated: dynamoField(z.boolean()),
});

type InboxEmailLinkRowType = z.infer<typeof InboxEmailLinkRow>;

function toEntry(row: InboxEmailLinkRowType): InboxEmailLinkEntry {
	assert(row.url !== undefined, "link row missing url");
	assert(row.status !== undefined, "link row missing status");
	return {
		userId: row.userId,
		receivedAtMessageId: row.receivedAtMessageId,
		ordinal: EmailLinkOrdinalSchema.parse(row.ordinal),
		url: row.url,
		resolvedUrl: row.resolvedUrl,
		status: row.status,
		title: row.title,
		excerpt: row.excerpt,
		siteName: row.siteName,
		imageUrl: row.imageUrl,
		failureReason: row.failureReason,
		skipReason: row.skipReason,
	};
}

export function initDynamoDbInboxEmailLink(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): InboxEmailLinkStore {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: InboxEmailLinkRow,
	});

	const deleteLinksByEmail: InboxEmailLinkStore["deleteLinksByEmail"] = async ({
		userId,
		receivedAtMessageId,
	}) => {
		const group = groupKey({ userId, receivedAtMessageId });
		await forEachQueryPage(
			table,
			{
				KeyConditionExpression: "userLinkGroup = :g",
				ExpressionAttributeValues: { ":g": group },
			},
			async (rows) => {
				await Promise.all(
					rows.map((row) =>
						table.delete({ Key: { userLinkGroup: row.userLinkGroup, ordinal: row.ordinal } }),
					),
				);
			},
		);
	};

	return {
		putLink: async (link) => {
			// A pending link carries no preview fields; the document client does not
			// drop undefined, so write only the columns that are set.
			const Item: Record<string, unknown> = {
				userLinkGroup: groupKey(link),
				ordinal: link.ordinal,
				userId: link.userId,
				receivedAtMessageId: link.receivedAtMessageId,
				url: link.url,
				status: link.status,
			};
			if (link.skipReason !== undefined) Item.skipReason = link.skipReason;
			try {
				await table.put({ Item, ConditionExpression: "attribute_not_exists(ordinal)" });
				return "stored";
			} catch (error) {
				if (error instanceof ConditionalCheckFailedException) return "duplicate";
				throw error;
			}
		},
		setLinkOutcome: async ({ userId, receivedAtMessageId, ordinal, outcome }) => {
			const Key = { userLinkGroup: groupKey({ userId, receivedAtMessageId }), ordinal };
			if (outcome.status === "crawled") {
				const sets = ["#status = :status", "#title = :title", "#excerpt = :excerpt", "#siteName = :siteName"];
				const names: Record<string, string> = {
					"#status": "status",
					"#title": "title",
					"#excerpt": "excerpt",
					"#siteName": "siteName",
					"#imageUrl": "imageUrl",
					"#resolvedUrl": "resolvedUrl",
					"#failureReason": "failureReason",
					"#skipReason": "skipReason",
				};
				const values: Record<string, unknown> = {
					":status": "crawled",
					":title": outcome.title,
					":excerpt": outcome.excerpt,
					":siteName": outcome.siteName,
				};
				const removes = ["#failureReason", "#skipReason"];
				if (outcome.imageUrl !== undefined) {
					sets.push("#imageUrl = :imageUrl");
					values[":imageUrl"] = outcome.imageUrl;
				} else {
					removes.push("#imageUrl");
				}
				if (outcome.resolvedUrl !== undefined) {
					sets.push("#resolvedUrl = :resolvedUrl");
					values[":resolvedUrl"] = outcome.resolvedUrl;
				} else {
					removes.push("#resolvedUrl");
				}
				await table.update({
					Key,
					// Fail closed if the pending row is gone: a bare UpdateItem would
					// upsert a partial item with no url/userId, which then fails the read
					// schema and breaks the whole email's link list.
					ConditionExpression: "attribute_exists(ordinal)",
					UpdateExpression: `SET ${sets.join(", ")} REMOVE ${removes.join(", ")}`,
					ExpressionAttributeNames: names,
					ExpressionAttributeValues: values,
				});
				return;
			}
			await table.update({
				Key,
				ConditionExpression: "attribute_exists(ordinal)",
				UpdateExpression:
					"SET #status = :status, #failureReason = :failureReason REMOVE #title, #excerpt, #siteName, #imageUrl, #resolvedUrl, #skipReason",
				ExpressionAttributeNames: {
					"#status": "status",
					"#failureReason": "failureReason",
					"#title": "title",
					"#excerpt": "excerpt",
					"#siteName": "siteName",
					"#imageUrl": "imageUrl",
					"#resolvedUrl": "resolvedUrl",
					"#skipReason": "skipReason",
				},
				ExpressionAttributeValues: { ":status": "failed", ":failureReason": outcome.failureReason },
			});
		},
		putLinksMeta: async ({ userId, receivedAtMessageId, meta }) => {
			await table.put({
				Item: {
					userLinkGroup: groupKey({ userId, receivedAtMessageId }),
					ordinal: META_SORT_KEY,
					userId,
					receivedAtMessageId,
					truncated: meta.truncated,
				},
			});
		},
		listLinksByEmail: async ({ userId, receivedAtMessageId }) => {
			const { items } = await table.query({
				KeyConditionExpression: "userLinkGroup = :pk",
				ExpressionAttributeValues: { ":pk": groupKey({ userId, receivedAtMessageId }) },
				ScanIndexForward: true,
			});
			const links: InboxEmailLinkEntry[] = [];
			let meta: InboxEmailLinksMeta | undefined;
			for (const item of items) {
				if (item.ordinal === META_SORT_KEY) {
					meta = { truncated: Boolean(item.truncated) };
					continue;
				}
				links.push(toEntry(item));
			}
			return { links, meta };
		},
		getLink: async ({ userId, receivedAtMessageId, ordinal }) => {
			const row = await table.get({
				userLinkGroup: groupKey({ userId, receivedAtMessageId }),
				ordinal,
			});
			if (row === undefined) return undefined;
			return toEntry(row);
		},
		deleteLinksByEmail,
		deleteAllLinksByUserId: async (userId, receivedAtMessageIds) => {
			for (const receivedAtMessageId of receivedAtMessageIds) {
				await deleteLinksByEmail({ userId, receivedAtMessageId });
			}
		},
	};
}
