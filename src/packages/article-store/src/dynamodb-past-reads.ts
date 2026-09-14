import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	ArticleStatusSchema,
	ReaderArticleHashIdSchema,
} from "@packages/domain/article";
import {
	DEFAULT_READLIST_SLUG,
	type ReadlistSlug,
	ReadlistSlugSchema,
} from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	batchGetFromTable,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import type {
	FindPastReads,
	FindReadCandidatesAcrossReadlists,
	MarkPastReadsReady,
	PastReadDisplay,
	ReadPastReadsState,
	ReadlistReadCandidate,
} from "@packages/provider-contracts/related-articles";
import { z } from "zod";
import { ARTICLE_FIELDS, LinkableArticle, initArticleReads, usable } from "./related-articles-rows";
import {
	READLIST_DEFINITION_KEY_PREFIX,
	decodeUserArticlePartition,
	partitionFor,
} from "./user-readlist-partition";

const PastReadLinkRow = z.object({
	url: z.string(),
	reason: z.string(),
	readlist: dynamoField(ReadlistSlugSchema),
});

const UserArticlePastReadsRow = z.object({
	userId: z.string(),
	url: z.string(),
	savedAt: dynamoField(z.string()),
	readAt: dynamoField(z.string()),
	pastReadsArticles: dynamoField(z.array(PastReadLinkRow)),
	pastReadsFingerprint: dynamoField(z.string()),
	pastReadsComputedAt: dynamoField(z.string()),
	pastReadsInputTokens: dynamoField(z.number()),
	pastReadsOutputTokens: dynamoField(z.number()),
});

const ReadlistDefinitionRow = z.object({
	queueSlug: ReadlistSlugSchema,
	createdAt: z.string(),
});

const SavedStatusRow = z.looseObject({
	userId: z.string(),
	url: z.string(),
	status: ArticleStatusSchema,
	readAt: z.string().optional(),
});

/** Drop a duplicate slug while keeping the first occurrence, so the priority
 * order (source list, default, then owned in creation order) has no repeats. */
function unique(slugs: readonly ReadlistSlug[]): ReadlistSlug[] {
	return [...new Set(slugs)];
}

export function initDynamoDbPastReads(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	userArticlesTableName: string;
}): {
	findReadCandidatesAcrossReadlists: FindReadCandidatesAcrossReadlists;
	readPastReadsState: ReadPastReadsState;
	markPastReadsReady: MarkPastReadsReady;
	findPastReads: FindPastReads;
} {
	const { client, tableName, userArticlesTableName } = deps;

	const userArticles = defineDynamoTable({
		client,
		tableName: userArticlesTableName,
		schema: UserArticlePastReadsRow,
	});
	const readlistDefinitionRows = defineDynamoTable({
		client,
		tableName: userArticlesTableName,
		schema: ReadlistDefinitionRow,
	});

	const { readArticles, hydrateCandidates } = initArticleReads({
		client,
		tableName,
	});

	const ownedReadlistSlugsInCreationOrder = async (
		userId: UserId,
	): Promise<ReadlistSlug[]> => {
		const rows: { slug: ReadlistSlug; createdAt: string }[] = [];
		await forEachQueryPage(
			readlistDefinitionRows,
			{
				KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: {
					":userId": userId,
					":prefix": READLIST_DEFINITION_KEY_PREFIX,
				},
				ConsistentRead: true,
			},
			async (items) => {
				for (const item of items) rows.push({ slug: item.queueSlug, createdAt: item.createdAt });
			},
		);
		return rows
			.sort(
				(a, b) =>
					new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
					a.slug.localeCompare(b.slug),
			)
			.map((row) => row.slug);
	};

	/** Read one partition's most-recent reads (newest first), stopping once we
	 * have `limit` — a url in the global most-recent `limit` is within each
	 * partition's own most-recent `limit`, so a per-partition cap loses nothing. */
	const readNewestFromPartition = async (
		partition: string,
		excludeKey: string,
		limit: number,
	): Promise<{ url: string; readAt: string }[]> => {
		const collected: { url: string; readAt: string }[] = [];
		let exclusiveStartKey: Record<string, unknown> | undefined;
		do {
			const { items, lastEvaluatedKey } = await userArticles.query({
				IndexName: "userId-readAt-index",
				/* c8 ignore next -- V8 block-coverage phantom on the awaited page read, see bcoe/c8#319 */
				KeyConditionExpression: "userId = :userId",
				ExpressionAttributeValues: { ":userId": partition },
				ScanIndexForward: false,
				ExclusiveStartKey: exclusiveStartKey,
			});
			for (const item of items) {
				if (item.url === excludeKey) continue;
				if (collected.length >= limit) break;
				// The userId-readAt-index is sparse on readAt, so every row it returns
				// carries one — a missing value would be a schema/index contract break.
				assert(item.readAt, "userId-readAt-index only returns rows with readAt");
				collected.push({ url: item.url, readAt: item.readAt });
			}
			exclusiveStartKey = lastEvaluatedKey;
		} while (exclusiveStartKey && collected.length < limit);
		return collected;
	};

	const findReadCandidatesAcrossReadlists: FindReadCandidatesAcrossReadlists = async (
		params,
	) => {
		const excludeKey = ArticleResourceUniqueId.parse(params.excludeUrl).value;
		const ownedSlugs = await ownedReadlistSlugsInCreationOrder(params.userId);
		const readlists: ReadlistSlug[] = [DEFAULT_READLIST_SLUG, ...ownedSlugs];

		const bestByUrl = new Map<
			string,
			{ readAt: string; readlist?: ReadlistSlug }
		>();
		for (const readlist of readlists) {
			const partition = partitionFor({ userId: params.userId, readlist });
			const hint = readlist === DEFAULT_READLIST_SLUG ? undefined : readlist;
			const rows = await readNewestFromPartition(partition, excludeKey, params.limit);
			for (const row of rows) {
				const existing = bestByUrl.get(row.url);
				if (existing === undefined || row.readAt > existing.readAt) {
					bestByUrl.set(row.url, { readAt: row.readAt, readlist: hint });
				}
			}
		}

		const orderedUrls = [...bestByUrl.entries()]
			.sort((a, b) => (a[1].readAt > b[1].readAt ? -1 : a[1].readAt < b[1].readAt ? 1 : a[0].localeCompare(b[0])))
			.slice(0, params.limit)
			.map(([url]) => url);

		const { candidates, awaitingCrawl } = await hydrateCandidates(orderedUrls);
		const withReadlist: ReadlistReadCandidate[] = candidates.map((candidate) => {
			const best = bestByUrl.get(candidate.url);
			assert(best, "every hydrated candidate came from the gathered read set");
			return best.readlist === undefined
				? { ...candidate }
				: { ...candidate, readlist: best.readlist };
		});
		return { candidates: withReadlist, awaitingCrawl };
	};

	const readPastReadsState: ReadPastReadsState = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const row = await userArticles.get({
			userId: params.userId,
			url: articleResourceUniqueId.value,
		});
		return {
			...(row?.pastReadsFingerprint !== undefined
				? { fingerprint: row.pastReadsFingerprint }
				: {}),
			...(row?.pastReadsComputedAt !== undefined
				? { computedAt: new Date(row.pastReadsComputedAt) }
				: {}),
		};
	};

	const markPastReadsReady: MarkPastReadsReady = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const articles = params.pastReads.map((link) => ({
			url: link.url,
			reason: link.reason,
			...(link.readlist !== undefined ? { readlist: link.readlist } : {}),
		}));
		const expressionAttributeValues = {
			":articles": articles,
			":fingerprint": params.fingerprint,
			":at": params.at.toISOString(),
			":inputTokens": params.inputTokens,
			":outputTokens": params.outputTokens,
		};
		try {
			await userArticles.update({
				Key: { userId: params.userId, url: articleResourceUniqueId.value },
				UpdateExpression:
					"SET pastReadsArticles = :articles, pastReadsFingerprint = :fingerprint, pastReadsComputedAt = :at, pastReadsInputTokens = :inputTokens, pastReadsOutputTokens = :outputTokens",
				// Recompute-safe, not terminal-once: an authenticated reader re-runs
				// this whenever they revisit, but an older run that lands late must
				// not clobber a newer answer, and neither may recreate a deleted save.
				ConditionExpression:
					"attribute_exists(savedAt) AND (attribute_not_exists(pastReadsComputedAt) OR pastReadsComputedAt < :at)",
				ExpressionAttributeValues: expressionAttributeValues,
				/* c8 ignore next -- V8 block-coverage phantom on the awaited update continuation, see bcoe/c8#319 */
			});
			return "stored";
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return "superseded";
			throw error;
		}
	};

	const findPastReads: FindPastReads = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const row = await userArticles.get({
			userId: params.userId,
			url: articleResourceUniqueId.value,
		});
		if (!row?.pastReadsComputedAt) return { status: "pending" };

		const links = row.pastReadsArticles ?? [];
		if (links.length === 0) return { status: "ready", items: [] };

		const ownedSlugs = await ownedReadlistSlugsInCreationOrder(params.userId);
		const allReadlists: ReadlistSlug[] = [DEFAULT_READLIST_SLUG, ...ownedSlugs];
		const priority = unique([
			...(params.sourceReadlist !== undefined ? [params.sourceReadlist] : []),
			DEFAULT_READLIST_SLUG,
			...ownedSlugs,
		]);

		// Re-check ownership and read status across every list the reader owns —
		// a match may have moved lists, been marked unread, or been deleted since
		// it was computed, and only currently-read, still-owned matches qualify.
		const saved = await batchGetFromTable({
			client,
			tableName: userArticlesTableName,
			schema: SavedStatusRow,
			keys: links.flatMap((link) =>
				allReadlists.map((readlist) => ({
					userId: partitionFor({ userId: params.userId, readlist }),
					url: link.url,
				})),
			),
			projection: ["userId", "url", "status", "readAt"],
		});
		const ownedListsByUrl = new Map<string, ReadlistSlug[]>();
		const readSomewhere = new Set<string>();
		// The latest read instant across every list a match is still read in, so
		// the reader can say when it last saw it.
		const lastReadByUrl = new Map<string, string>();
		for (const entry of saved) {
			const readlist =
				decodeUserArticlePartition(entry.userId).readlist ?? DEFAULT_READLIST_SLUG;
			const lists = ownedListsByUrl.get(entry.url) ?? [];
			lists.push(readlist);
			ownedListsByUrl.set(entry.url, lists);
			if (entry.status !== "read") continue;
			readSomewhere.add(entry.url);
			if (entry.readAt === undefined) continue;
			const latest = lastReadByUrl.get(entry.url);
			if (latest === undefined || entry.readAt > latest) {
				lastReadByUrl.set(entry.url, entry.readAt);
			}
		}

		const stillLinked = links.filter((link) => readSomewhere.has(link.url));
		if (stillLinked.length === 0) return { status: "ready", items: [] };

		const byUrl = await readArticles(
			stillLinked.map((link) => link.url),
			ARTICLE_FIELDS,
		);

		const items: PastReadDisplay[] = [];
		for (const link of stillLinked) {
			const article = usable(LinkableArticle, byUrl.get(link.url));
			if (!article) continue;
			// A match read somewhere is owned somewhere, and every list it is owned
			// in is one of allReadlists, which the priority order spans — so both the
			// lookup and the destination search are total by construction.
			const lists = ownedListsByUrl.get(link.url);
			assert(lists, "a match read somewhere is owned in at least one list");
			const destination = priority.find((readlist) => lists.includes(readlist));
			assert(destination, "an owned list is always within the priority order");
			const lastReadAt = lastReadByUrl.get(link.url);
			items.push({
				id: ReaderArticleHashIdSchema.parse(article.routeId),
				title: article.title,
				siteName: article.siteName,
				reason: link.reason,
				...(lastReadAt !== undefined ? { readAt: new Date(lastReadAt) } : {}),
				...(destination === DEFAULT_READLIST_SLUG ? {} : { readlist: destination }),
			});
		}
		return { status: "ready", items };
	};

	return {
		findReadCandidatesAcrossReadlists,
		readPastReadsState,
		markPastReadsReady,
		findPastReads,
	};
}
