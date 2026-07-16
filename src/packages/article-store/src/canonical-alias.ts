import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
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
});

/**
 * First-writer-wins claim of `id(aliasUrl) → targetOriginalUrl`.
 * `"claimed"` when this call created the marker; `"occupied"` when the identity
 * is already taken (by another alias OR a real article row) — the caller must
 * never overwrite either.
 */
export type ClaimCanonicalAlias = (params: {
	aliasUrl: string;
	targetOriginalUrl: string;
	now: Date;
}) => Promise<"claimed" | "occupied">;

/** Full original URL an alias resolves to, or `undefined` when `id(url)` is not
 * an alias (no row, or a real article row). Depth-1 by construction: the value
 * is a stored URL, never itself resolved again. */
export type ResolveCanonicalAlias = (url: string) => Promise<string | undefined>;

/** The identity a save/view should operate on: the alias target when `url` is an
 * adopted terminal, else `url` unchanged. Depth-1 — an alias never points at
 * another alias, so one lookup is total. */
export type ResolveCanonicalIdentity = (url: string) => Promise<string>;

/** Stamp the redirect destination onto the origin article at `id(articleUrl)` so
 * the reader / queue / API can show where it lives while `url` stays the lookup
 * identity. Best-effort and idempotent; a no-op when the target is not a real
 * article row. */
export type SetArticleDisplayUrl = (params: {
	articleUrl: string;
	displayUrl: string;
}) => Promise<void>;

export function initCanonicalAliasStore(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	claimAlias: ClaimCanonicalAlias;
	resolveAlias: ResolveCanonicalAlias;
	setDisplayUrl: SetArticleDisplayUrl;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: CanonicalAliasRow,
	});

	const claimAlias: ClaimCanonicalAlias = async ({ aliasUrl, targetOriginalUrl, now }) => {
		try {
			await table.update({
				Key: { url: ArticleResourceUniqueId.parse(aliasUrl).value },
				UpdateExpression: "SET rowKind = :alias, aliasTargetUrl = :target, aliasCreatedAt = :now",
				ConditionExpression: "attribute_not_exists(#url)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: {
					":alias": "alias",
					":target": targetOriginalUrl,
					":now": now.toISOString(),
				},
			});
			return "claimed";
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return "occupied";
			throw error;
		}
	};

	const resolveAlias: ResolveCanonicalAlias = async (url) => {
		const row = await table.get({ url: ArticleResourceUniqueId.parse(url).value });
		if (row?.rowKind !== "alias") return undefined;
		return row.aliasTargetUrl;
	};

	const setDisplayUrl: SetArticleDisplayUrl = async ({ articleUrl, displayUrl }) => {
		try {
			await table.update({
				Key: { url: ArticleResourceUniqueId.parse(articleUrl).value },
				UpdateExpression: "SET displayUrl = :displayUrl",
				// Only annotate an existing real article (a `routeId` row): a missing
				// or alias row is left untouched so this never forges a partial row
				// that a strict `ArticleRow` read would 500 on.
				ConditionExpression: "attribute_exists(routeId)",
				ExpressionAttributeValues: { ":displayUrl": displayUrl },
			});
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return;
			throw error;
		}
	};

	return { claimAlias, resolveAlias, setDisplayUrl };
}

export function initResolveCanonicalIdentity(deps: {
	resolveAlias: ResolveCanonicalAlias;
}): ResolveCanonicalIdentity {
	return async (url) => (await deps.resolveAlias(url)) ?? url;
}
