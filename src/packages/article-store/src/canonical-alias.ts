import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { stubMetadataFor } from "@packages/domain/article";
import {
	ConditionalCheckFailedException,
	TransactionCanceledException,
	TransactWriteCommand,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import type {
	ClaimCanonicalAlias,
	FindIdentityRow,
	IdentityRow,
	PinContentSource,
	RepairWrapperIdentity,
} from "@packages/provider-contracts/article-store";
import { z } from "zod";

/**
 * A canonical-alias marker lives in the SAME `hutch-articles` table, under the
 * partition key `id(terminalUrl)` — the identity a redirecting URL resolves to.
 * Sharing the key space with real article rows is deliberate: it lets a claim
 * and `saveArticleGlobally` contend on the one item so exactly one wins, and it
 * makes an alias reachable by the same `id(url)` lookup intake already performs.
 *
 * The columns are namespaced (`rowKind`/`aliasTargetUrl`/`aliasCreatedAt`) so
 * they never collide with article attributes, and the read schema keeps every
 * field optional (`dynamoField`) so a plain article row parses cleanly with
 * `rowKind` simply absent — that absence is how a reader tells the two apart.
 */
const CanonicalAliasRow = z.object({
	rowKind: dynamoField(z.literal("alias")),
	aliasTargetUrl: dynamoField(z.string()),
	aliasCreatedAt: dynamoField(z.string()),
	originalUrl: dynamoField(z.string()),
	// A real article's redirect destination, read back through this same table
	// handle so a re-crawl can pin its fetch to the terminal (see findAdoptedFetchUrl).
	displayUrl: dynamoField(z.string()),
	contentSourceUrl: dynamoField(z.string()),
	sourceOriginalUrl: dynamoField(z.string()),
	purgedAt: dynamoField(z.string()),
});

export type { ClaimCanonicalAlias, FindIdentityRow, IdentityRow, PinContentSource };

/** Full original URL an alias resolves to, or `undefined` when `id(url)` is not
 * an alias (no row, or a real article row). Depth-1 by construction: the value
 * is a stored URL, never itself resolved again. */
export type ResolveCanonicalAlias = (url: string) => Promise<string | undefined>;

export type SetArticleDisplayUrl = (params: {
	articleUrl: string;
	displayUrl: string;
}) => Promise<void>;

export type ReconcileStubMetadata = (params: {
	articleUrl: string;
	displayUrl: string;
}) => Promise<void>;

/** The URL a re-crawl of `url` must actually fetch: the redirect terminal an
 * adopted article was pinned to (its `displayUrl`), or `undefined` for a normal
 * article, so the crawl fetches `url` itself. Closes the content-poisoning
 * vector — a re-crawl never re-fetches the origin that redirected here. */
export type FindAdoptedFetchUrl = (url: string) => Promise<string | undefined>;

export type FindContentSourceUrl = (url: string) => Promise<string | undefined>;

export type AdoptArticleDestination = (params: { articleUrl: string; destinationUrl: string; now: Date }) => Promise<"adopted" | "declined">;

export function initCanonicalAliasStore(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	claimAlias: ClaimCanonicalAlias;
	resolveAlias: ResolveCanonicalAlias;
	findIdentityRow: FindIdentityRow;
	setDisplayUrl: SetArticleDisplayUrl;
	pinContentSource: PinContentSource;
	reconcileStubMetadata: ReconcileStubMetadata;
	findAdoptedFetchUrl: FindAdoptedFetchUrl;
	findContentSourceUrl: FindContentSourceUrl;
	adoptDestination: AdoptArticleDestination;
	repairWrapperIdentity: RepairWrapperIdentity;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: CanonicalAliasRow,
	});

	const claimAlias: ClaimCanonicalAlias = async ({ aliasUrl, targetOriginalUrl, now, sourceBinding }) => {
		try {
			await table.update({
				Key: { url: ArticleResourceUniqueId.parse(aliasUrl).value },
				UpdateExpression: `SET rowKind = :alias, aliasTargetUrl = :target, aliasCreatedAt = :now${sourceBinding === undefined ? "" : ", contentSourceUrl = :source, sourceOriginalUrl = :original"}`,
				ConditionExpression: sourceBinding === undefined ? "attribute_not_exists(#url)" : "attribute_not_exists(#url) OR (rowKind = :alias AND aliasTargetUrl = :target)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: {
					":alias": "alias",
					":target": targetOriginalUrl,
					":now": now.toISOString(),
					...(sourceBinding === undefined ? {} : { ":source": sourceBinding.contentSourceUrl, ":original": sourceBinding.sourceOriginalUrl }),
				},
			});
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return;
			throw error;
		}
	};

	const resolveAlias: ResolveCanonicalAlias = async (url) => {
		const row = await table.get({ url: ArticleResourceUniqueId.parse(url).value });
		if (row?.rowKind !== "alias") return undefined;
		return row.aliasTargetUrl;
	};

	const findIdentityRow: FindIdentityRow = async (url) => {
		const key = ArticleResourceUniqueId.parse(url).value;
		const row = await table.get({ url: key }, { consistentRead: true });
		if (!row) return { kind: "absent" };
		const sourceBinding = row.contentSourceUrl !== undefined && row.sourceOriginalUrl !== undefined
			? { contentSourceUrl: row.contentSourceUrl, sourceOriginalUrl: row.sourceOriginalUrl }
			: undefined;
		if (row.rowKind !== "alias") return { kind: "article", originalUrl: row.purgedAt === undefined ? row.displayUrl ?? row.originalUrl : row.displayUrl, sourceBinding };
		assert(row.aliasTargetUrl !== undefined, `alias row "${key}" has no aliasTargetUrl`);
		return { kind: "alias", targetUrl: row.aliasTargetUrl, sourceBinding };
	};

	const pinContentSource: PinContentSource = async ({ articleUrl, contentSourceUrl, sourceOriginalUrl }) => {
		const pin = {
			Key: { url: ArticleResourceUniqueId.parse(articleUrl).value },
			UpdateExpression: "SET contentSourceUrl = :contentSourceUrl, sourceOriginalUrl = :sourceOriginalUrl",
			ConditionExpression: "attribute_exists(routeId) AND (displayUrl = :sourceOriginalUrl OR (attribute_not_exists(displayUrl) AND originalUrl = :sourceOriginalUrl))",
			ExpressionAttributeValues: { ":contentSourceUrl": contentSourceUrl, ":sourceOriginalUrl": sourceOriginalUrl },
		};
		try {
			await table.update({
				...pin,
				UpdateExpression: `${pin.UpdateExpression}, directContentBeforePin = :true`,
				ConditionExpression: `${pin.ConditionExpression} AND attribute_not_exists(contentSourceUrl) AND attribute_not_exists(canonicalCandidateId) AND (contentSourceTier IN (:tier0, :tier1) OR (attribute_not_exists(contentSourceTier) AND wordCount > :zero))`,
				ExpressionAttributeValues: { ...pin.ExpressionAttributeValues, ":true": true, ":tier0": "tier-0", ":tier1": "tier-1", ":zero": 0 },
			});
		} catch (error) {
			if (!(error instanceof ConditionalCheckFailedException)) throw error;
			await table.update(pin);
		}
	};

	const setDisplayUrl: SetArticleDisplayUrl = async ({ articleUrl, displayUrl }) => {
		try {
			await table.update({
				Key: { url: ArticleResourceUniqueId.parse(articleUrl).value },
				UpdateExpression: "SET displayUrl = :displayUrl",
				ConditionExpression: "attribute_exists(routeId)",
				ExpressionAttributeValues: { ":displayUrl": displayUrl },
			});
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return;
			throw error;
		}
	};

	const reconcileStubMetadata: ReconcileStubMetadata = async ({ articleUrl, displayUrl }) => {
		const destinationStub = stubMetadataFor(new URL(displayUrl).hostname);
		const originStub = stubMetadataFor(new URL(articleUrl).hostname);
		try {
			await table.update({
				Key: { url: ArticleResourceUniqueId.parse(articleUrl).value },
				UpdateExpression: "SET title = :title, siteName = :siteName, excerpt = :excerpt",
				ConditionExpression: "attribute_exists(routeId) AND title = :originStubTitle",
				ExpressionAttributeValues: {
					":title": destinationStub.title,
					":siteName": destinationStub.siteName,
					":excerpt": destinationStub.excerpt,
					":originStubTitle": originStub.title,
				},
			});
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return;
			throw error;
		}
	};

	const findAdoptedFetchUrl: FindAdoptedFetchUrl = async (url) => {
		const row = await table.get({ url: ArticleResourceUniqueId.parse(url).value });
		// Only an adopted real article carries displayUrl; a normal article and an
		// alias row both lack it, so the crawl falls back to fetching `url` as-is.
		return row?.displayUrl;
	};

	const findContentSourceUrl: FindContentSourceUrl = async (url) => {
		const row = await table.get({ url: ArticleResourceUniqueId.parse(url).value });
		return row?.contentSourceUrl;
	};

	const adoptDestination: AdoptArticleDestination = async ({ articleUrl, destinationUrl, now }) => {
		const pinDestination = {
			Key: { url: ArticleResourceUniqueId.parse(articleUrl).value },
			UpdateExpression: "SET displayUrl = :destination",
			ConditionExpression: "attribute_exists(routeId) AND (attribute_not_exists(sourceOriginalUrl) OR sourceOriginalUrl = :destination) AND (attribute_not_exists(displayUrl) OR displayUrl = :destination) AND (attribute_not_exists(contentSourceTier) OR contentSourceTier <> :firstPartyTier) AND (attribute_not_exists(canonicalOriginalUrl) OR canonicalOriginalUrl = :destination)",
			ExpressionAttributeValues: { ":destination": destinationUrl, ":firstPartyTier": "tier-0" },
		};
		try {
			await deps.client.send(new TransactWriteCommand({ TransactItems: [
				{ Update: {
					TableName: deps.tableName,
					Key: { url: ArticleResourceUniqueId.parse(destinationUrl).value },
					UpdateExpression: "SET rowKind = :alias, aliasTargetUrl = :target, aliasCreatedAt = :now",
					ConditionExpression: "attribute_not_exists(#url) OR (rowKind = :alias AND aliasTargetUrl = :target)",
					ExpressionAttributeNames: { "#url": "url" },
					ExpressionAttributeValues: { ":alias": "alias", ":target": articleUrl, ":now": now.toISOString() },
				} },
				{ Update: { TableName: deps.tableName, ...pinDestination } },
			] }));
			return "adopted";
		} catch (error) {
			if (!(error instanceof TransactionCanceledException)) throw error;
			const [aliasReason, articleReason] = error.CancellationReasons ?? [];
			if (articleReason?.Code === "ConditionalCheckFailed") return "declined";
			if (aliasReason?.Code !== "ConditionalCheckFailed") throw error;
		}
		try {
			await table.update(pinDestination);
			return "adopted";
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return "declined";
			throw error;
		}
	};

	const repairWrapperIdentity: RepairWrapperIdentity = async ({ articleUrl, expectedOriginalUrl, originalUrl, contentSourceUrl }) => {
		try {
			await table.update({
				Key: { url: ArticleResourceUniqueId.parse(articleUrl).value },
				UpdateExpression: contentSourceUrl === undefined ? "SET displayUrl = :original REMOVE contentSourceUrl, sourceOriginalUrl" : "SET displayUrl = :original, contentSourceUrl = :source, sourceOriginalUrl = :original",
				ConditionExpression: "attribute_exists(routeId) AND (displayUrl = :expected OR (attribute_not_exists(displayUrl) AND originalUrl = :expected)) AND (attribute_not_exists(sourceOriginalUrl) OR sourceOriginalUrl = :original)",
				ExpressionAttributeValues: { ":original": originalUrl, ":expected": expectedOriginalUrl, ...(contentSourceUrl === undefined ? {} : { ":source": contentSourceUrl }) },
			});
			return true;
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return false;
			throw error;
		}
	};

	return {
		repairWrapperIdentity,
		claimAlias,
		resolveAlias,
		findIdentityRow,
		setDisplayUrl,
		pinContentSource,
		reconcileStubMetadata,
		findAdoptedFetchUrl,
		findContentSourceUrl,
		adoptDestination,
	};
}
