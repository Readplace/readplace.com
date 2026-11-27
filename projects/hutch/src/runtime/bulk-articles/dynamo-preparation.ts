import { z } from "zod";
import { defineDynamoTable, type DynamoDBDocumentClient } from "@packages/storage-client";
import { UNKNOWN_ORIGIN_FILTER } from "@packages/article-store";
import { discoveryCandidateOf, matchesArticleDiscovery, personalReadlistPartition, ReaderArticleHashId, readlistFilterOf, resolveArticleDiscovery } from "@packages/domain/article";
import type { FindArticleById, ResolveCanonicalIdentity } from "@packages/provider-contracts/article-store";
import { BULK_CHUNK_SIZE, selectionTarget, type BulkSelection, type SelectionTarget } from "./selection";

const Cursor = z.object({
	key: z.record(z.string(), z.string()).optional(),
	issue: z.string().optional(),
	link: z.string().optional(),
});

export function initBulkPreparation(deps: {
	client: DynamoDBDocumentClient; saves: string; emails: string; links: string;
	findArticleById: FindArticleById; resolveCanonicalIdentity: ResolveCanonicalIdentity;
}) {
	const table = (tableName: string) => defineDynamoTable({ client: deps.client, tableName, schema: z.object({
		url: z.string().optional(), savedAt: z.string().optional(), resolvedUrl: z.string().optional(), receivedAtMessageId: z.string().optional(),
		personalOrder: z.string().optional(), unknownOrigin: z.boolean().optional(), ordinal: z.string().optional(),
	}) });
	const saves = table(deps.saves);
	const emails = table(deps.emails);
	const links = table(deps.links);
	return async (job: BulkSelection, remainingMs: () => number) => {
		const { userId, spec } = job;
		const cursor = Cursor.parse(job.cursor ? JSON.parse(job.cursor) : {});
		const discovery = spec.discovery && resolveArticleDiscovery({ ...readlistFilterOf(spec.discovery), q: spec.discovery.q, now: new Date(job.createdAt) });
		const targets: SelectionTarget[] = [];
		async function collect(id: ReaderArticleHashId, unknownOrigin = false) {
			const article = await deps.findArticleById(id, userId);
			if (!article) return false;
			if (article.savedAt.toISOString() <= job.createdAt && article.status === spec.status
				&& (spec.source !== "picked" || article.personalPickedAt && article.personalPickedAt.toISOString() <= job.createdAt)
				&& (spec.source !== "bulk" || article.bulkSave || article.provenance?.kind === "import")
				&& (spec.source !== "unknown" || unknownOrigin || !article.provenance)
				&& (!discovery || matchesArticleDiscovery(discoveryCandidateOf(article), discovery))) targets.push(selectionTarget(article));
			return true;
		}
		if (spec.source !== "sender") {
			const pickedScope = spec.source === "picked" ? personalReadlistPartition(userId, "picked", spec.status) : undefined;
			const rawUnknownOrigin = spec.source === "unknown" && spec.action.kind === "read-everywhere";
			const index = pickedScope ? {
				IndexName: "personalScope-personalOrder-index",
				KeyConditionExpression: "personalScope = :scope AND personalOrder <= :cutoff",
				ExpressionAttributeValues: { ":scope": pickedScope, ":cutoff": `${job.createdAt}#\uffff` },
			} : {
				IndexName: "userId-savedAt-index",
				KeyConditionExpression: "userId = :user AND savedAt <= :cutoff",
				...(rawUnknownOrigin ? { FilterExpression: UNKNOWN_ORIGIN_FILTER } : {}),
				ExpressionAttributeValues: { ":user": userId, ":cutoff": job.createdAt, ...(rawUnknownOrigin ? { ":flag": true } : {}) },
			};
			const page = await saves.query({ ...index, Limit: BULK_CHUNK_SIZE, ExclusiveStartKey: cursor.key });
			let last: Record<string, string> | undefined;
			for (const row of page.items) {
				if (remainingMs() < 10_000) {
					if (!last) throw new Error("bulk preparation needs more time");
					return { targets, next: JSON.stringify({ key: last }) };
				}
				if (!row.url || !row.savedAt) throw new Error("save index returned an incomplete key");
				await collect(ReaderArticleHashId.fromResourceUniqueId(row.url), rawUnknownOrigin || row.unknownOrigin);
				if (pickedScope && !row.personalOrder) throw new Error("personal index returned an incomplete key");
				last = pickedScope && row.personalOrder
					? { userId, url: row.url, personalScope: pickedScope, personalOrder: row.personalOrder }
					: { userId, url: row.url, savedAt: row.savedAt };
			}
			return { targets, next: page.lastEvaluatedKey && JSON.stringify({ key: page.lastEvaluatedKey }) };
		}
		if (!cursor.issue) {
			const page = await emails.query({ KeyConditionExpression: "userId = :user AND receivedAtMessageId <= :cutoff",
				FilterExpression: "senderEmail = :sender AND #status = :received", ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: { ":user": userId, ":cutoff": `${job.createdAt}#\uffff`, ":sender": spec.sender, ":received": "received" },
				Limit: 1, ExclusiveStartKey: cursor.key, ConsistentRead: true });
			const issue = page.items[0]?.receivedAtMessageId;
			return { targets, next: issue || page.lastEvaluatedKey ? JSON.stringify({ key: page.lastEvaluatedKey, issue }) : undefined };
		}
		const group = `${userId}#${cursor.issue}`;
		const page = await links.query({ KeyConditionExpression: "userLinkGroup = :group AND ordinal BETWEEN :first AND :last",
			ExpressionAttributeValues: { ":group": group, ":first": "0000", ":last": "9999" }, Limit: BULK_CHUNK_SIZE, ConsistentRead: true,
			ExclusiveStartKey: cursor.link ? { userLinkGroup: group, ordinal: cursor.link } : undefined });
		let lastOrdinal: string | undefined;
		for (const row of page.items) {
			if (remainingMs() < 10_000) {
				if (!lastOrdinal) throw new Error("bulk preparation needs more time");
				return { targets, next: JSON.stringify({ ...cursor, link: lastOrdinal }) };
			}
			lastOrdinal = row.ordinal;
			for (const url of new Set([row.resolvedUrl, row.url])) {
				if (url && URL.canParse(url) && await collect(ReaderArticleHashId.from(await deps.resolveCanonicalIdentity(url)))) break;
			}
		}
		return { targets, next: page.lastEvaluatedKey ? JSON.stringify({ ...cursor, link: page.lastEvaluatedKey.ordinal })
			: cursor.key ? JSON.stringify({ key: cursor.key }) : undefined };
	};
}
