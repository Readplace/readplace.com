import assert from "node:assert";
import {
	ArticleStatusSchema,
	type HeldLink,
	type HoldOutcome,
	type NewsletterLinkCandidate,
	type NewsletterLinkRow,
	type RemovalSenders,
	SaveProvenanceSchema,
	SavedLinksJobIdSchema,
	decideHold,
	heldLinkExpiresAt,
	isHeldLinkLive,
	isNewsletterLink,
	summariseNewsletterLinkRows,
} from "@packages/domain/article";
import { emailIssueKeyPrefix } from "@packages/domain/inbox";
import { type ReadlistSlug, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type {
	CountNewsletterIssues,
	FindHeldLink,
	FindOriginalUrls,
	FindKeysInAll,
	FindUnrestorableArticles,
	ForEachHeldLinkPage,
	ForEachRemovalCandidatePage,
	HasHeldLinks,
	HasNewsletterLink,
	ListKeysOpenedInReadlists,
	MoveNewsletterLinkToHold,
	RestoreHeldLink,
	SummariseNewsletterLinks,
} from "@packages/provider-contracts/article-store";
import {
	type DynamoDBDocumentClient,
	TransactWriteCommand,
	TransactionCanceledException,
	batchGetFromTable,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/storage-client";
import { z } from "zod";
import {
	canonicalRemovalKey,
	HIGHLIGHT_KEY_PREFIX,
	READLIST_DEFINITION_KEY_PREFIX,
	readlistPartitionValue,
	removedLinkKey,
	removedLinksPartition,
} from "./user-readlist-partition";
import { listOwnedReadlistSlugs } from "./readlist-definition-rows";

const PartitionItem = z.looseObject({ url: z.string() });

const NewsletterLinkItem = z.object({
	url: z.string(),
	status: ArticleStatusSchema,
	savedAt: z.string(),
	provenance: dynamoField(SaveProvenanceSchema),
	handPickedAt: dynamoField(z.string()),
	personalPickedAt: dynamoField(z.string()),
	viewedAt: dynamoField(z.string()),
	lastSummaryOpenedAt: dynamoField(z.string()),
	restoredAt: dynamoField(z.string()),
});

const HeldLinkItem = z.object({
	url: z.string(),
	removedUrl: z.string(),
	removedByJobId: SavedLinksJobIdSchema,
	removedAt: z.string(),
	expiresAt: z.number(),
	provenance: z.object({ senderEmail: z.string() }),
});

const SharedArticleItem = z.object({ purgedAt: dynamoField(z.string()) });

const AllKeyItem = z.object({ url: z.string() });
const PurgedArticleItem = z.object({ url: z.string(), purgedAt: dynamoField(z.string()) });

const OriginalUrlItem = z.object({ url: z.string(), originalUrl: z.string() });

const NEWSLETTER_LINK_PAGE_ROWS = 300;

const HELD_LINK_ATTRIBUTES = ["url", "removedUrl", "removedByJobId", "removedAt", "expiresAt", "provenance"];

const HOLD_ATTRIBUTES = ["removedUrl", "removedByJobId", "removedAt", "expiresAt"] as const;

const RETRIED_CANCELLATION_CODES = new Set([
	"TransactionConflict",
	"ThrottlingError",
	"ProvisionedThroughputExceeded",
	"RequestLimitExceeded",
]);

const MAX_TRANSACTION_ATTEMPTS = 5;

const HighlightItem = z.object({ highlightOf: z.string() });

const ReadlistViewItem = z.object({ url: z.string(), viewedAt: dynamoField(z.string()) });

const RESERVED_KEY_PREFIX = "readplace:";

const LINK_ATTRIBUTES = [
	"url",
	"status",
	"savedAt",
	"provenance",
	"handPickedAt",
	"personalPickedAt",
	"viewedAt",
	"lastSummaryOpenedAt",
	"restoredAt",
];

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
		...(item.personalPickedAt === undefined ? {} : { personalPickedAt: new Date(item.personalPickedAt) }),
		...(item.handPickedAt === undefined ? {} : { handPickedAt: new Date(item.handPickedAt) }),
		...(item.viewedAt === undefined ? {} : { viewedAt: new Date(item.viewedAt) }),
		...(item.lastSummaryOpenedAt === undefined ? {} : { lastSummaryOpenedAt: new Date(item.lastSummaryOpenedAt) }),
		...(item.restoredAt === undefined ? {} : { restoredAt: new Date(item.restoredAt) }),
	};
}

function toHeldLink(item: z.infer<typeof HeldLinkItem>): HeldLink {
	return {
		heldKey: item.url,
		storedKey: item.removedUrl,
		jobId: item.removedByJobId,
		removedAt: new Date(item.removedAt),
		expiresAt: new Date(item.expiresAt * 1000),
		senderEmail: item.provenance.senderEmail,
	};
}

function holdOutcomeOf(params: {
	item: Record<string, unknown> | undefined;
	userId: UserId;
	cutoff: Date;
	senders: RemovalSenders;
}): HoldOutcome {
	if (params.item === undefined) return { outcome: "not-selected" };
	const parsed = NewsletterLinkItem.safeParse(params.item);
	if (!parsed.success) return { outcome: "skipped", reason: "unreadable" };
	const decision = decideHold({ ...params, row: toNewsletterLinkRow(parsed.data) });
	if (decision.kind === "hold") return { outcome: "held" };
	if (decision.kind === "skipped") return { outcome: "skipped", reason: decision.reason };
	return { outcome: "not-selected" };
}

type TransactionResult = { kind: "written" } | { kind: "condition-failed"; failedAt: number };

async function transactWithRetry(params: {
	client: DynamoDBDocumentClient;
	transactItems: NonNullable<TransactWriteCommand["input"]["TransactItems"]>;
}): Promise<TransactionResult> {
	for (let attempt = 1; ; attempt++) {
		try {
			await params.client.send(new TransactWriteCommand({ TransactItems: params.transactItems }));
			return { kind: "written" };
		} catch (error) {
			if (!(error instanceof TransactionCanceledException)) throw error;
			const reasons = error.CancellationReasons;
			assert(reasons, "a cancelled transaction names a reason for each item");
			const codes = reasons.map((reason) => String(reason.Code));
			const failedAt = codes.indexOf("ConditionalCheckFailed");
			if (failedAt !== -1 && codes.every((code) => code === "None" || code === "ConditionalCheckFailed")) {
				return { kind: "condition-failed", failedAt };
			}
			if (attempt === MAX_TRANSACTION_ATTEMPTS || !codes.some((code) => RETRIED_CANCELLATION_CODES.has(code))) {
				throw error;
			}
		}
	}
}

export function initDynamoDbRemovedLinks(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
	articlesTableName: string;
}): {
	hasNewsletterLink: HasNewsletterLink;
	summariseNewsletterLinks: SummariseNewsletterLinks;
	countNewsletterIssues: CountNewsletterIssues;
	moveNewsletterLinkToHold: MoveNewsletterLinkToHold;
	restoreHeldLink: RestoreHeldLink;
	forEachHeldLinkPage: ForEachHeldLinkPage;
	hasHeldLinks: HasHeldLinks;
	findHeldLink: FindHeldLink;
	forEachRemovalCandidatePage: ForEachRemovalCandidatePage;
	listKeysOpenedInReadlists: ListKeysOpenedInReadlists;
	findOriginalUrls: FindOriginalUrls;
	findUnrestorableArticles: FindUnrestorableArticles;
	findKeysInAll: FindKeysInAll;
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
			const page = await userArticles.query({ ...input, Limit: NEWSLETTER_LINK_PAGE_ROWS, ExclusiveStartKey: exclusiveStartKey });
			const found = page.items.some((item) => {
				const parsed = NewsletterLinkItem.safeParse(item);
				return parsed.success && isNewsletterLink({ row: toNewsletterLinkRow(parsed.data), userId });
			});
			if (found) return true;
			exclusiveStartKey = page.lastEvaluatedKey;
		} while (exclusiveStartKey);
		return false;
	};

	const isLinkKey = (params: { url: string; issuePrefix: string }) =>
		!params.url.startsWith(RESERVED_KEY_PREFIX) && !params.url.startsWith(params.issuePrefix);

	const candidateOf = (item: Record<string, unknown>): NewsletterLinkCandidate => {
		const parsed = NewsletterLinkItem.safeParse(item);
		return parsed.success ? { kind: "row", row: toNewsletterLinkRow(parsed.data) } : { kind: "unreadable" };
	};

	const keysOpenedIn = async (params: { userId: UserId; readlists: readonly ReadlistSlug[] }) => {
		const opened = new Set<string>();
		for (const readlist of params.readlists) {
			await forEachQueryPage(
				userArticles,
				{
					KeyConditionExpression: "userId = :userId",
					ExpressionAttributeValues: { ":userId": readlistPartitionValue({ userId: params.userId, readlist }) },
					...projectionOf(["url", "viewedAt"]),
				},
				async (items) => {
					for (const item of items) {
						if (ReadlistViewItem.parse(item).viewedAt !== undefined) opened.add(item.url);
					}
				},
			);
		}
		return opened;
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
					if (isLinkKey({ url: item.url, issuePrefix })) candidates.push(candidateOf(item));
				}
			},
		);
		const openedInReadlists = await keysOpenedIn({ userId, readlists });
		return summariseNewsletterLinkRows({ candidates, userId, highlighted, openedInReadlists, cutoff });
	};

	const forEachRemovalCandidatePage: ForEachRemovalCandidatePage = async ({ userId, onPage }) => {
		const issuePrefix = emailIssueKeyPrefix(userId);
		await forEachQueryPage(userArticles, allPartitionQuery({ userId, attributes: LINK_ATTRIBUTES }), async (items) => {
			await onPage(items.filter((item) => isLinkKey({ url: item.url, issuePrefix })).map(candidateOf));
		});
	};

	const listKeysOpenedInReadlists: ListKeysOpenedInReadlists = async ({ userId }) => {
		const readlists = await listOwnedReadlistSlugs({ client: deps.client, tableName: deps.userArticlesTableName, userId });
		return keysOpenedIn({ userId, readlists });
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

	const sharedArticles = defineDynamoTable({
		client: deps.client,
		tableName: deps.articlesTableName,
		schema: SharedArticleItem,
	});

	const findOriginalUrls: FindOriginalUrls = async ({ storedKeys }) => {
		const rows = await batchGetFromTable({
			client: deps.client,
			tableName: deps.articlesTableName,
			schema: OriginalUrlItem,
			keys: storedKeys.map((url) => ({ url })),
			projection: ["url", "originalUrl"],
		});
		return new Map(rows.map((row) => [row.url, row.originalUrl]));
	};

	const findUnrestorableArticles: FindUnrestorableArticles = async ({ storedKeys }) => {
		const rows = await batchGetFromTable({
			client: deps.client,
			tableName: deps.articlesTableName,
			schema: PurgedArticleItem,
			keys: storedKeys.map((url) => ({ url })),
			projection: ["url", "purgedAt"],
		});
		const restorable = new Set(rows.filter((row) => row.purgedAt === undefined).map((row) => row.url));
		return new Set(storedKeys.filter((storedKey) => !restorable.has(storedKey)));
	};

	const findKeysInAll: FindKeysInAll = async ({ userId, storedKeys }) => {
		const rows = await batchGetFromTable({
			client: deps.client,
			tableName: deps.userArticlesTableName,
			schema: AllKeyItem,
			keys: storedKeys.map((url) => ({ userId, url })),
			projection: ["url"],
		});
		return new Set(rows.map((row) => row.url));
	};

	const moveNewsletterLinkToHold: MoveNewsletterLinkToHold = async (params) => {
		const { userId, jobId, storedKey, cutoff, now } = params;
		const allKey = { userId, url: storedKey };
		const current = await userArticles.get(allKey, { consistentRead: true });
		const decided = holdOutcomeOf({ ...params, item: current });
		if (decided.outcome !== "held") return decided;
		assert(current, "a row chosen for the hold was read");
		const { personalScope, personalOrder, ...heldState } = current;
		const result = await transactWithRetry({
			client: deps.client,
			transactItems: [
				{
					Put: {
						TableName: deps.userArticlesTableName,
						Item: {
							...heldState,
							...(personalScope ? { heldPersonalScope: personalScope, heldPersonalOrder: personalOrder } : {}),
							userId: removedLinksPartition(userId),
							url: removedLinkKey({ jobId, storedKey }),
							removedUrl: storedKey,
							removedByJobId: jobId,
							removedAt: now.toISOString(),
							expiresAt: Math.floor(heldLinkExpiresAt(now).getTime() / 1000),
						},
					},
				},
				{
					Delete: {
						TableName: deps.userArticlesTableName,
						Key: allKey,
						ConditionExpression: [
							"savedAt = :readSavedAt",
							"savedAt <= :cutoff",
							"#status = :unread",
							"provenance.kind = :email",
							"attribute_not_exists(handPickedAt)",
							"attribute_not_exists(personalPickedAt)",
							current.personalDecision === undefined ? "attribute_not_exists(personalDecision)" : "personalDecision = :decision",
							personalScope === undefined ? "attribute_not_exists(personalScope)" : "personalScope = :scope",
							"attribute_not_exists(viewedAt)",
							"attribute_not_exists(lastSummaryOpenedAt)",
							"(attribute_not_exists(restoredAt) OR restoredAt < :cutoff)",
							"NOT begins_with(#url, :issueKeyPrefix)",
						].join(" AND "),
						ExpressionAttributeNames: { "#status": "status", "#url": "url" },
						ExpressionAttributeValues: {
							":readSavedAt": current.savedAt,
							...(current.personalDecision === undefined ? {} : { ":decision": current.personalDecision }),
							...(personalScope === undefined ? {} : { ":scope": personalScope }),
							":cutoff": cutoff.toISOString(),
							":unread": "unread",
							":email": "email",
							":issueKeyPrefix": emailIssueKeyPrefix(userId),
						},
					},
				},
				{ Update: {
					TableName: deps.userArticlesTableName,
					Key: canonicalRemovalKey(userId, storedKey),
					UpdateExpression: "SET removedAt = :at",
					ConditionExpression: "attribute_not_exists(removedAt) OR removedAt <= :at",
					ExpressionAttributeValues: { ":at": now.toISOString() },
				} },
			],
		});
		if (result.kind === "written") return { outcome: "held" };
		const changed = holdOutcomeOf({ ...params, item: await userArticles.get(allKey, { consistentRead: true }) });
		return changed.outcome === "held" ? { outcome: "skipped", reason: "changed" } : changed;
	};

	const restoreHeldLink: RestoreHeldLink = async ({ userId, heldKey, now }) => {
		const heldRowKey = { userId: removedLinksPartition(userId), url: heldKey };
		const held = await userArticles.get(heldRowKey, { consistentRead: true });
		if (held === undefined) return { outcome: "gone" };
		const { removedUrl, removedAt, expiresAt } = HeldLinkItem.parse(held);
		if (expiresAt <= Math.floor(now.getTime() / 1000)) return { outcome: "gone" };
		const shared = await sharedArticles.get({ url: removedUrl }, { projection: ["purgedAt"] });
		if (shared === undefined || shared.purgedAt !== undefined) return { outcome: "unrestorable" };
		const { heldPersonalScope, heldPersonalOrder, ...heldState } = held;
		const restored: Record<string, unknown> = { ...heldState, ...(heldPersonalScope ? { personalScope: heldPersonalScope, personalOrder: heldPersonalOrder } : {}), userId, url: removedUrl, restoredAt: now.toISOString() };
		for (const attribute of HOLD_ATTRIBUTES) delete restored[attribute];
		const result = await transactWithRetry({
			client: deps.client,
			transactItems: [
				{
					Put: {
						TableName: deps.userArticlesTableName,
						Item: restored,
						ConditionExpression: "attribute_not_exists(#url)",
						ExpressionAttributeNames: { "#url": "url" },
					},
				},
				{
					Delete: {
						TableName: deps.userArticlesTableName,
						Key: heldRowKey,
						ConditionExpression: "attribute_exists(#url)",
						ExpressionAttributeNames: { "#url": "url" },
					},
				},
				{ ConditionCheck: {
					TableName: deps.userArticlesTableName,
					Key: canonicalRemovalKey(userId, removedUrl),
					ConditionExpression: "attribute_not_exists(removedAt) OR removedAt = :at",
					ExpressionAttributeValues: { ":at": removedAt },
				} },
			],
		});
		if (result.kind === "written") return { outcome: "restored" };
		if (result.failedAt === 2) return { outcome: "unrestorable" };
		return result.failedAt === 0 ? { outcome: "already-in-all" } : { outcome: "gone" };
	};

	const holdingPartitionQuery = (userId: UserId) => ({
		KeyConditionExpression: "userId = :userId",
		ExpressionAttributeValues: { ":userId": removedLinksPartition(userId) },
		...projectionOf(HELD_LINK_ATTRIBUTES),
	});

	const forEachHeldLinkPage: ForEachHeldLinkPage = async ({ userId, now, onPage }) => {
		await forEachQueryPage(userArticles, holdingPartitionQuery(userId), async (items) => {
			await onPage(
				items.map((item) => toHeldLink(HeldLinkItem.parse(item))).filter((link) => isHeldLinkLive({ link, now })),
			);
		});
	};

	const hasHeldLinks: HasHeldLinks = async ({ userId, now }) => {
		const page = await userArticles.query({ ...holdingPartitionQuery(userId), ScanIndexForward: false, Limit: 1 });
		return page.items.some((item) => isHeldLinkLive({ link: toHeldLink(HeldLinkItem.parse(item)), now }));
	};

	const findHeldLink: FindHeldLink = async ({ userId, storedKey, now }) => {
		const matches: HeldLink[] = [];
		const query = holdingPartitionQuery(userId);
		await forEachQueryPage(
			userArticles,
			{
				...query,
				FilterExpression: "#removedUrl = :storedKey",
				ExpressionAttributeValues: { ...query.ExpressionAttributeValues, ":storedKey": storedKey },
			},
			async (items) => {
				for (const item of items) matches.push(toHeldLink(HeldLinkItem.parse(item)));
			},
		);
		return matches.find((link) => isHeldLinkLive({ link, now }));
	};

	return {
		hasNewsletterLink,
		summariseNewsletterLinks,
		countNewsletterIssues,
		moveNewsletterLinkToHold,
		restoreHeldLink,
		forEachHeldLinkPage,
		hasHeldLinks,
		findHeldLink,
		forEachRemovalCandidatePage,
		listKeysOpenedInReadlists,
		findOriginalUrls,
		findUnrestorableArticles,
		findKeysInAll,
	};
}
