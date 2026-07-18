import { GetObjectCommand, NoSuchKey, S3ServiceException, type S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { StoredCrawlVersionSchema, normalizeCrawlVersion } from "./crawl-version-log";

const TIER_0 = "tier-0";

const CrawlVersionsRow = z.object({
	crawlVersions: dynamoField(z.array(StoredCrawlVersionSchema)),
});

const TierSourceAuthorSchema = z.object({
	authorUserId: z.string().optional(),
});

function safeJsonParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** The S3 objects a user authored for a URL: their attributed version
 * snapshots (scoped to one when `versionMinuteId` is given) and — for the
 * whole-copy scope only — their tier-0 capture with its metadata sidecar.
 * `pruneMinuteIds` names the crawlVersions entries the caller must drop from
 * the log once the objects are gone. */
export type ResolveAuthoredContentKeys = (params: {
	url: string;
	userId: string;
	versionMinuteId?: string;
}) => Promise<{ objectKeys: string[]; pruneMinuteIds: string[] }>;

export function initResolveAuthoredContentKeys(deps: {
	s3Client: Pick<S3Client, "send">;
	dynamoClient: DynamoDBDocumentClient;
	tableName: string;
	bucketName: string;
}): { resolveAuthoredContentKeys: ResolveAuthoredContentKeys } {
	const articleTable = defineDynamoTable({
		client: deps.dynamoClient,
		tableName: deps.tableName,
		schema: CrawlVersionsRow,
	});

	async function readTierZeroAuthor(id: ArticleResourceUniqueId): Promise<string | undefined> {
		let body: string;
		try {
			const response = await deps.s3Client.send(
				new GetObjectCommand({
					Bucket: deps.bucketName,
					Key: id.toS3SourceMetadataKey({ tier: TIER_0 }),
				}),
			);
			if (!response.Body) return undefined;
			body = await response.Body.transformToString("utf-8");
		} catch (error) {
			/* c8 ignore next -- V8 block coverage phantom: the true-path is exercised by the missing-sidecar test yet reports a zero-count sub-range, see bcoe/c8#319 */
			if (error instanceof NoSuchKey) return undefined;
			if (error instanceof S3ServiceException && error.name === "NoSuchKey") return undefined;
			throw error;
		}
		/* A malformed sidecar means the capture cannot be attributed — treat it as
		 * unauthored rather than throwing, which would redeliver the removal
		 * command forever against the same broken bytes. */
		const parsed = TierSourceAuthorSchema.safeParse(safeJsonParse(body));
		if (!parsed.success) return undefined;
		return parsed.data.authorUserId;
	}

	const resolveAuthoredContentKeys: ResolveAuthoredContentKeys = async (params) => {
		const id = ArticleResourceUniqueId.parse(params.url);

		const row = await articleTable.get(
			{ url: id.value },
			{ projection: ["crawlVersions"] },
		);
		const authoredEntries = (row?.crawlVersions ?? [])
			.map(normalizeCrawlVersion)
			.filter((entry) => entry.authorUserId === params.userId)
			.filter(
				(entry) =>
					params.versionMinuteId === undefined ||
					entry.minuteId === params.versionMinuteId,
			);

		const objectKeys = authoredEntries.map((entry) =>
			id.toS3ContentVersionKey({ minuteId: entry.minuteId }),
		);
		const pruneMinuteIds = authoredEntries.map((entry) => entry.minuteId);

		if (params.versionMinuteId === undefined) {
			const tierZeroAuthor = await readTierZeroAuthor(id);
			if (tierZeroAuthor === params.userId) {
				objectKeys.push(
					id.toS3SourceKey({ tier: TIER_0 }),
					id.toS3SourceMetadataKey({ tier: TIER_0 }),
				);
			}
		}

		return { objectKeys, pruneMinuteIds };
	};

	return { resolveAuthoredContentKeys };
}
