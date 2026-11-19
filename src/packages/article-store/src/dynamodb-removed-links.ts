import {
	ArticleStatusSchema,
	type NewsletterLinkCandidate,
	type NewsletterLinkRow,
	SaveProvenanceSchema,
	isNewsletterLink,
	summariseNewsletterLinkRows,
} from "@packages/domain/article";
import { emailIssueKeyPrefix } from "@packages/domain/inbox";
import { type ReadlistSlug, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type {
	CountNewsletterIssues,
	HasNewsletterLink,
	SummariseNewsletterLinks,
} from "@packages/provider-contracts/article-store";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/storage-client";
import { z } from "zod";
import { HIGHLIGHT_KEY_PREFIX, READLIST_DEFINITION_KEY_PREFIX, readlistPartitionValue } from "./user-readlist-partition";

const PartitionItem = z.looseObject({ url: z.string() });

const NewsletterLinkItem = z.object({
	url: z.string(),
	status: ArticleStatusSchema,
	savedAt: z.string(),
	provenance: dynamoField(SaveProvenanceSchema),
	handPickedAt: dynamoField(z.string()),
	viewedAt: dynamoField(z.string()),
});

const HighlightItem = z.object({ highlightOf: z.string() });

const ReadlistViewItem = z.object({ url: z.string(), viewedAt: dynamoField(z.string()) });

const RESERVED_KEY_PREFIX = "readplace:";

const LINK_ATTRIBUTES = ["url", "status", "savedAt", "provenance", "handPickedAt", "viewedAt"];

function projectionOf(attributes: readonly string[]) {
	return {
		ProjectionExpression: attributes.map((attribute) => `#${attribute}`).join(", "),
		ExpressionAttributeNames: Object.fromEntries(attributes.map((attribute) => [`#${attribute}`, attribute])),
	};
}

function toNewsletterLinkRow(item: z.infer<typeof NewsletterLinkItem>): NewsletterLinkRow {
	return {
		storedKey: item.url,
		status: item.status,
		savedAt: new Date(item.savedAt),
		...(item.provenance === undefined ? {} : { provenance: item.provenance }),
		...(item.handPickedAt === undefined ? {} : { handPickedAt: new Date(item.handPickedAt) }),
		...(item.viewedAt === undefined ? {} : { viewedAt: new Date(item.viewedAt) }),
	};
}

export function initDynamoDbRemovedLinks(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
}): {
	hasNewsletterLink: HasNewsletterLink;
	summariseNewsletterLinks: SummariseNewsletterLinks;
	countNewsletterIssues: CountNewsletterIssues;
} {
	const userArticles = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: PartitionItem,
	});

	const allPartitionQuery = (params: { userId: UserId; attributes: readonly string[] }) => ({
		KeyConditionExpression: "userId = :userId",
		ExpressionAttributeValues: { ":userId": params.userId },
		...projectionOf(params.attributes),
	});

	const hasNewsletterLink: HasNewsletterLink = async ({ userId }) => {
		const input = allPartitionQuery({ userId, attributes: LINK_ATTRIBUTES });
		let exclusiveStartKey: Record<string, unknown> | undefined;
		do {
			const page = await userArticles.query({ ...input, ExclusiveStartKey: exclusiveStartKey });
			const found = page.items.some((item) => {
				const parsed = NewsletterLinkItem.safeParse(item);
				return parsed.success && isNewsletterLink({ row: toNewsletterLinkRow(parsed.data), userId });
			});
			if (found) return true;
			exclusiveStartKey = page.lastEvaluatedKey;
		} while (exclusiveStartKey);
		return false;
	};

	const summariseNewsletterLinks: SummariseNewsletterLinks = async ({ userId, cutoff }) => {
		const issuePrefix = emailIssueKeyPrefix(userId);
		const candidates: NewsletterLinkCandidate[] = [];
		const highlighted = new Set<string>();
		const readlists: ReadlistSlug[] = [];
		await forEachQueryPage(
			userArticles,
			allPartitionQuery({ userId, attributes: [...LINK_ATTRIBUTES, "highlightOf"] }),
			async (items) => {
				for (const item of items) {
					if (item.url.startsWith(HIGHLIGHT_KEY_PREFIX)) {
						const { highlightOf } = HighlightItem.parse(item);
						highlighted.add(highlightOf);
						continue;
					}
					if (item.url.startsWith(READLIST_DEFINITION_KEY_PREFIX)) {
						readlists.push(ReadlistSlugSchema.parse(item.url.slice(READLIST_DEFINITION_KEY_PREFIX.length)));
						continue;
					}
					if (item.url.startsWith(RESERVED_KEY_PREFIX) || item.url.startsWith(issuePrefix)) continue;
					const parsed = NewsletterLinkItem.safeParse(item);
					candidates.push(parsed.success ? { kind: "row", row: toNewsletterLinkRow(parsed.data) } : { kind: "unreadable" });
				}
			},
		);
		const openedInReadlists = new Set<string>();
		for (const readlist of readlists) {
			await forEachQueryPage(
				userArticles,
				{
					KeyConditionExpression: "userId = :userId",
					ExpressionAttributeValues: { ":userId": readlistPartitionValue({ userId, readlist }) },
					...projectionOf(["url", "viewedAt"]),
				},
				async (items) => {
					for (const item of items) {
						if (ReadlistViewItem.parse(item).viewedAt !== undefined) openedInReadlists.add(item.url);
					}
				},
			);
		}
		return summariseNewsletterLinkRows({ candidates, userId, highlighted, openedInReadlists, cutoff });
	};

	const countNewsletterIssues: CountNewsletterIssues = async ({ userId }) => {
		let total = 0;
		await forEachQueryPage(
			{
				query: async (input) => {
					const page = await userArticles.query(input);
					total += page.count;
					return page;
				},
			},
			{
				KeyConditionExpression: "userId = :userId AND begins_with(#url, :issueKeyPrefix)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: { ":userId": userId, ":issueKeyPrefix": emailIssueKeyPrefix(userId) },
				Select: "COUNT",
			},
			async () => {},
		);
		return total;
	};

	return { hasNewsletterLink, summariseNewsletterLinks, countNewsletterIssues };
}
