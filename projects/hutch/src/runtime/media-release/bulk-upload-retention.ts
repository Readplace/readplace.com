import { z } from "zod";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { canonicalRemovalKey, readlistPartitionValue } from "@packages/article-store";
import { UserIdSchema, type UserId } from "@packages/domain/user";
import { PrivateItemUrlSchema } from "@packages/media-contracts";
import type { ListUserSavesForUrl } from "@packages/provider-contracts/article-store";
import { defineDynamoTable, forEachQueryPage, transactIfConditions, TransactWriteCommand, type DynamoDBDocumentClient } from "@packages/storage-client";
import type { ReleasePrivateItem } from "./private-item-release-steps";

export function initBulkUploadRetention(deps: {
	client: DynamoDBDocumentClient; tableName: string; listUserSavesForUrl: ListUserSavesForUrl;
	releasePrivateItem: ReleasePrivateItem; now: () => Date;
}) {
	const { client, tableName } = deps;
	const markers = defineDynamoTable({ client, tableName, schema: z.object({
		userId: UserIdSchema, removedAt: z.string().optional(), privateReleaseAt: z.number().optional(), privateReleaseUrl: PrivateItemUrlSchema.optional(),
	}) });
	async function releaseIfUnheld(item: { userId: UserId; url: string }, scheduled = false) {
		const articleKey = ArticleResourceUniqueId.parse(item.url).value;
		const key = canonicalRemovalKey(item.userId, articleKey);
		const hold = await markers.get(key, { consistentRead: true });
		const deadline = hold?.privateReleaseAt;
		if (scheduled && (deadline === undefined || hold?.privateReleaseUrl !== item.url)) return "retained" as const;
		if (deadline !== undefined && deadline > Math.floor(deps.now().getTime() / 1000)) return "retained" as const;
		const expected = deadline === undefined ? { ConditionExpression: "attribute_not_exists(privateReleaseAt)" }
			: { ConditionExpression: "privateReleaseAt = :deadline AND removedAt = :removed", ExpressionAttributeValues: { ":deadline": deadline, ":removed": hold?.removedAt } };
		let outcome: Awaited<ReturnType<ReleasePrivateItem>> | "retained" = "retained";
		let copies = await deps.listUserSavesForUrl(item);
		if (!copies.length) {
			// A restore puts the canonical row and clears the hold in the same transaction.
			// Closing its token here decides the race before irreversible object deletion.
			const claim = await transactIfConditions(() => client.send(new TransactWriteCommand({ TransactItems: [
				{ ConditionCheck: { TableName: tableName, Key: { userId: item.userId, url: articleKey }, ConditionExpression: "attribute_not_exists(savedAt)" } },
				deadline === undefined ? { ConditionCheck: { TableName: tableName, Key: key, ...expected } }
					: { Update: { TableName: tableName, Key: key, ...expected,
						UpdateExpression: "SET privateReleaseClaim = :claimed REMOVE bulkRemoval", ExpressionAttributeValues: { ...expected.ExpressionAttributeValues, ":claimed": true } } },
			] })));
			if (claim.kind !== "written") return "retained" as const;
			// A named filing can win just before the claim. Once claimed, filing transactions
			// cannot create another copy while object deletion is in flight or being retried.
			if (deadline !== undefined) copies = await deps.listUserSavesForUrl(item);
			if (!copies.length) outcome = await deps.releasePrivateItem(item);
		}
		if (deadline !== undefined) {
			const copy = copies[0];
			const clear = await transactIfConditions(() => client.send(new TransactWriteCommand({ TransactItems: [
				...(copy ? [{ ConditionCheck: { TableName: tableName,
					Key: { userId: copy.readlist ? readlistPartitionValue({ userId: item.userId, readlist: copy.readlist }) : item.userId, url: articleKey },
					ConditionExpression: "attribute_exists(savedAt)" } }] : []),
				{ Update: { TableName: tableName, Key: key, ...expected, UpdateExpression: `REMOVE privateReleaseAt, privateReleaseUrl, bulkRemoval${outcome === "retained" ? ", privateReleaseClaim" : ""}` } },
			] })));
			if (copy && clear.kind !== "written") throw new Error("Private upload membership changed while clearing its hold");
		}
		return outcome;
	}
	return {
		releaseIfUnheld,
		async releaseExpired(marker: string) {
			// The schedule carries only a digest. Erasing the owner's marker removes its lookup.
			await forEachQueryPage(markers, { IndexName: "url-index", KeyConditionExpression: "#url = :marker",
				ExpressionAttributeNames: { "#url": "url" }, ExpressionAttributeValues: { ":marker": marker },
			}, async page => {
				for (const row of page) {
					if (row.privateReleaseUrl) await releaseIfUnheld({ userId: row.userId, url: row.privateReleaseUrl }, true);
				}
			});
		},
	};
}
