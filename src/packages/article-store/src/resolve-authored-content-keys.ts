import { GetObjectCommand, NoSuchKey, S3ServiceException, type S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { type CandidateId, CandidateIdSchema } from "@packages/domain/article";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { StoredCrawlVersionSchema, normalizeCrawlVersion } from "./crawl-version-log";
import type { ListContentKeys } from "./s3-list-content-keys";

const TIER_0 = "tier-0";

const CrawlVersionsRow = z.object({
	crawlVersions: dynamoField(z.array(StoredCrawlVersionSchema)),
});

const TierSourceAuthorSchema = z.object({
	authorUserId: z.string().optional(),
});

const CandidateManifestSchema = z.object({
	id: CandidateIdSchema,
	authorUserId: z.string().optional(),
	htmlLocation: z.string(),
	evaluationLocation: z.string(),
});

const MediaManifestSchema = z.object({
	authorUserId: z.string().optional(),
	objectKey: z.string(),
});

function safeJsonParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

export type ResolveAuthoredContentKeys = (params: {
	url: string;
	userId: string;
	versionMinuteId: string;
}) => Promise<{ objectKeys: string[]; manifestKeys: string[]; pruneMinuteIds: string[]; candidateIds: CandidateId[] }>;

export function initResolveAuthoredContentKeys(deps: {
	s3Client: Pick<S3Client, "send">;
	dynamoClient: DynamoDBDocumentClient;
	tableName: string;
	bucketName: string;
	listContentKeys: ListContentKeys;
}): { resolveAuthoredContentKeys: ResolveAuthoredContentKeys } {
	const articleTable = defineDynamoTable({
		client: deps.dynamoClient,
		tableName: deps.tableName,
		schema: CrawlVersionsRow,
	});

	async function readMetadata(key: string): Promise<unknown> {
		let body: string;
		try {
			const response = await deps.s3Client.send(
				new GetObjectCommand({
					Bucket: deps.bucketName,
					Key: key,
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
		return safeJsonParse(body);
	}

	async function ownedManifests<T extends { authorUserId?: string }>(params: { prefix: string; suffixPattern: RegExp; schema: z.ZodType<T>; userId: string }): Promise<{ key: string; metadata: T }[]> {
		const keys = await deps.listContentKeys(params.prefix);
		const manifests = await Promise.all(keys
			.filter((key) => params.suffixPattern.test(key.slice(params.prefix.length)))
			.map(async (key) => ({ key, parsed: params.schema.safeParse(await readMetadata(key)) })));
		return manifests.flatMap(({ key, parsed }) => parsed.success && parsed.data.authorUserId === params.userId ? [{ key, metadata: parsed.data }] : []);
	}

	async function authoredCandidateKeys(id: ArticleResourceUniqueId, userId: string, only?: ReadonlySet<CandidateId>): Promise<{ objectKeys: string[]; manifestKeys: string[]; candidateIds: CandidateId[] }> {
		const owned = (await ownedManifests({
			prefix: id.toS3CandidatesPrefix({ tier: TIER_0 }),
			suffixPattern: /^[a-f0-9]{64}\/metadata\.json$/,
			schema: CandidateManifestSchema,
			userId,
		})).filter(({ metadata }) => only === undefined || only.has(metadata.id));
		return {
			objectKeys: owned.flatMap(({ metadata }) => [metadata.htmlLocation, metadata.evaluationLocation]),
			manifestKeys: owned.map(({ key }) => key),
			candidateIds: owned.map(({ metadata }) => metadata.id),
		};
	}

	async function authoredMediaKeys(id: ArticleResourceUniqueId, userId: string) {
		const owned = await ownedManifests({
			prefix: id.toS3MediaOwnersPrefix(),
			suffixPattern: /^[a-f0-9]{64}\/[a-f0-9]{64}\.[a-z0-9]+\.metadata\.json$/,
			schema: MediaManifestSchema,
			userId,
		});
		return { objectKeys: owned.map(({ metadata }) => metadata.objectKey), manifestKeys: owned.map(({ key }) => key) };
	}

	const resolveAuthoredContentKeys: ResolveAuthoredContentKeys = async (params) => {
		const id = ArticleResourceUniqueId.parse(params.url);

		const row = await articleTable.get(
			{ url: id.value },
			{ projection: ["crawlVersions"], consistentRead: true },
		);
		const allAuthored = (row?.crawlVersions ?? [])
			.map(normalizeCrawlVersion)
			.filter((entry) => entry.authorUserId === params.userId);
		const namedEntries = allAuthored.filter(
			(entry) => entry.minuteId === params.versionMinuteId,
		);

		const objectKeys = namedEntries.flatMap((entry) => entry.candidateId === undefined ? [id.toS3ContentVersionKey({ minuteId: entry.minuteId })] : []);
		const manifestKeys: string[] = [];
		const pruneMinuteIds = namedEntries.map((entry) => entry.minuteId);
		const candidateIds: CandidateId[] = [];

		const isLastAuthoredVersion = allAuthored.length === 1 && namedEntries.length === 1;
		if (isLastAuthoredVersion) {
			const tierZeroAuthor = TierSourceAuthorSchema.safeParse(await readMetadata(id.toS3SourceMetadataKey({ tier: TIER_0 })));
			if (tierZeroAuthor.success && tierZeroAuthor.data.authorUserId === params.userId) {
				objectKeys.push(
					id.toS3SourceKey({ tier: TIER_0 }),
				);
				manifestKeys.push(id.toS3SourceMetadataKey({ tier: TIER_0 }));
			}
		}
		if (isLastAuthoredVersion || allAuthored.length === 0) {
			const candidates = await authoredCandidateKeys(id, params.userId);
			const media = await authoredMediaKeys(id, params.userId);
			objectKeys.push(...media.objectKeys);
			manifestKeys.push(...media.manifestKeys);
			objectKeys.push(...candidates.objectKeys);
			candidateIds.push(...candidates.candidateIds, ...allAuthored.flatMap((entry) => entry.candidateId === undefined ? [] : [entry.candidateId]));
			manifestKeys.push(...candidates.manifestKeys);
		} else {
			const remainingCandidateIds = new Set(allAuthored.filter((entry) => !namedEntries.includes(entry)).map((entry) => entry.candidateId));
			const removedCandidateIds = new Set(namedEntries.flatMap((entry) => entry.candidateId === undefined || remainingCandidateIds.has(entry.candidateId) ? [] : [entry.candidateId]));
			if (removedCandidateIds.size > 0) {
				const candidates = await authoredCandidateKeys(id, params.userId, removedCandidateIds);
				objectKeys.push(...candidates.objectKeys);
				manifestKeys.push(...candidates.manifestKeys);
				candidateIds.push(...removedCandidateIds);
			}
		}

		return { objectKeys: [...new Set(objectKeys)], manifestKeys: [...new Set(manifestKeys)], pruneMinuteIds, candidateIds: [...new Set(candidateIds)] };
	};

	return { resolveAuthoredContentKeys };
}
