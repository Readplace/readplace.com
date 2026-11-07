import { NoSuchKey, type S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { initResolveAuthoredContentKeys } from "@packages/article-store";
import { CandidateIdSchema } from "@packages/domain/article";
import type { Article, ContentSelectionSnapshot } from "@packages/domain/article-aggregate";
import { RecrawlLinkInitiatedEvent, ReselectAfterRemovalEvent } from "@packages/infra-components";
import { noopLogger } from "@packages/logger";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { TierSource } from "@packages/tier-source";
import type { SQSEvent } from "aws-lambda";
import { initRemoveMyContentCommandHandler } from "./remove-my-content-command-handler";

/**
 * 1. The SDK clients' `send` are heavily-overloaded generics the test fakes
 *    cannot structurally satisfy; the contained casts are the isolated
 *    SDK-wrapper exception in CLAUDE.md "Avoid TypeScript Type Assertions".
 */

const URL = "https://example.com/post";
const ENCODED = "example.com%2Fpost";
const READER = "reader-1";
const CANDIDATE_PREFIX = `articles/${ENCODED}/sources/tier-0.html.candidates/`;
const MEDIA_PREFIX = `articles/${ENCODED}/sources/media-owners/`;
const LEGACY_CANONICAL_KEY = `content/${ENCODED}/content.html`;
const REQUESTED_AT = "2026-07-16T10:00:00Z";
const REMOVED_VERSION = "2026-07-16T09:50Z";
const RESAVED_VERSION = "2026-07-16T10:05Z";

type StoredObject = { body: string; lastModified: Date };
type LogEntry = { minuteId: string; authorUserId: string; candidateId?: string };
type State = {
	crawlVersions: LogEntry[];
	revokedCandidateIds: string[];
	canonicalCandidateId: string | undefined;
	objects: Map<string, StoredObject>;
	published: string[];
};

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function capture(params: { id: string; at: string }) {
	const bodyPrefix = `${CANDIDATE_PREFIX}${sha(`body:${params.id}`)}/`;
	const manifestKey = `${CANDIDATE_PREFIX}${sha(params.id)}/metadata.json`;
	const htmlLocation = `${bodyPrefix}content.html`;
	const evaluationLocation = `${bodyPrefix}evaluation.html`;
	const mediaManifestKey = `${MEDIA_PREFIX}${sha(`scope:${params.id}`)}/${sha(`image:${params.id}`)}.png.metadata.json`;
	const mediaKey = `content/${ENCODED}/images/attempts/${params.id}.png`;
	const lastModified = new Date(params.at);
	return {
		id: params.id,
		keys: [manifestKey, htmlLocation, evaluationLocation, mediaManifestKey, mediaKey],
		objects: [
			[manifestKey, { body: JSON.stringify({ id: params.id, authorUserId: READER, fetchedAt: params.at, htmlLocation, evaluationLocation }), lastModified }],
			[htmlLocation, { body: "<p>body</p>", lastModified }],
			[evaluationLocation, { body: "<p>body</p>", lastModified }],
			[mediaManifestKey, { body: JSON.stringify({ authorUserId: READER, objectKey: mediaKey }), lastModified }],
			[mediaKey, { body: "png", lastModified }],
		] satisfies [string, StoredObject][],
	};
}

const earlier = capture({ id: "earlier-capture", at: "2026-07-16T09:50:10Z" });
const older = capture({ id: "older-capture", at: "2026-07-16T09:30:00Z" });
const resaved = capture({ id: "resaved-capture", at: "2026-07-16T10:05:00Z" });

function createState(params: { captures: ReturnType<typeof capture>[]; crawlVersions: LogEntry[]; canonicalCandidateId: string | undefined; revokedCandidateIds?: string[]; extraKeys?: string[] }): State {
	const objects = new Map<string, StoredObject>(params.captures.flatMap((entry) => entry.objects));
	for (const key of params.extraKeys ?? []) objects.set(key, { body: "legacy", lastModified: new Date("2026-07-01T00:00:00Z") });
	return {
		crawlVersions: params.crawlVersions,
		revokedCandidateIds: params.revokedCandidateIds ?? [],
		canonicalCandidateId: params.canonicalCandidateId,
		objects,
		published: [],
	};
}

function articleOf(state: State): Article | undefined {
	if (state.canonicalCandidateId === undefined) return undefined;
	const contentSelection: ContentSelectionSnapshot = {
		tier: "tier-0",
		candidateId: CandidateIdSchema.parse(state.canonicalCandidateId),
		revokedCandidateIds: state.revokedCandidateIds.map((id) => CandidateIdSchema.parse(id)),
	};
	return {
		url: URL,
		metadata: { title: "Article", siteName: "example.com", excerpt: "text", wordCount: 100 },
		estimatedReadTime: 1,
		freshness: { contentFetchedAt: "2026-07-16T09:50:10.000Z", canonicalContentHash: "hash" },
		crawl: { kind: "ready" },
		summary: { kind: "skipped" },
		summaryAutoHeal: { attempts: 0 },
		contentSelection,
	};
}

function remainingSources(state: State): TierSource[] {
	return [...state.objects.entries()].flatMap(([key, object]): TierSource[] => {
		if (!key.startsWith(CANDIDATE_PREFIX) || !key.endsWith("/metadata.json")) return [];
		const { id } = JSON.parse(object.body);
		if (state.revokedCandidateIds.includes(id)) return [];
		return [{ tier: "tier-0", html: "<p>body</p>", metadata: { title: "Title", siteName: "example.com", excerpt: "excerpt", wordCount: 100, estimatedReadTime: 1, id: CandidateIdSchema.parse(id) } }];
	});
}

function createRedrivableHandler(state: State) {
	const s3Client = {
		send: async (command: { input: { Key: string } }) => {
			const object = state.objects.get(command.input.Key);
			if (object === undefined) throw new NoSuchKey({ $metadata: {}, message: "no such key" });
			return { Body: { transformToString: async () => object.body }, LastModified: object.lastModified };
		},
	} as unknown as Pick<S3Client, "send"> /* 1 */;
	const dynamoClient = {
		send: async () => ({ Item: { url: `example.com/post`, crawlVersions: state.crawlVersions } }),
	} as unknown as DynamoDBDocumentClient /* 1 */;
	const { resolveAuthoredContentKeys } = initResolveAuthoredContentKeys({
		s3Client,
		dynamoClient,
		tableName: "articles",
		bucketName: "content",
		listContentKeys: async (prefix) => [...state.objects.keys()].filter((key) => key.startsWith(prefix)),
	});
	return initRemoveMyContentCommandHandler({
		resolveAuthoredContentKeys,
		revokeContentCandidates: async ({ candidateIds }) => {
			state.revokedCandidateIds = [...new Set([...state.revokedCandidateIds, ...candidateIds])];
		},
		loadArticle: async () => articleOf(state),
		saveArticle: async () => {},
		deleteContentObjects: async (keys) => {
			for (const key of keys) state.objects.delete(key);
		},
		pruneCrawlVersions: async ({ minuteIds }) => {
			state.crawlVersions = state.crawlVersions.filter((entry) => !minuteIds.includes(entry.minuteId));
		},
		listAvailableTierSources: async () => remainingSources(state),
		countSaversByUrl: async () => 1,
		purgeArticleContent: async () => {},
		tombstoneArticle: async () => {},
		publishEvent: async (event) => {
			state.published.push(event.detailType);
		},
		now: () => new Date("2026-07-16T12:00:00Z"),
		logger: noopLogger,
	});
}

function removal(params: { time: string; versionMinuteId: string }): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ time: params.time, detail: { url: URL, userId: READER, versionMinuteId: params.versionMinuteId } }),
			attributes: { ApproximateReceiveCount: "1", SentTimestamp: "1620000000000", SenderId: "TESTID", ApproximateFirstReceiveTimestamp: "1620000000001" },
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:remove-my-content-command",
			awsRegion: "ap-southeast-2",
		}],
	};
}

async function redrive(state: State, params: { time: string; versionMinuteId: string } = { time: REQUESTED_AT, versionMinuteId: REMOVED_VERSION }) {
	const handler = createRedrivableHandler(state);
	expect(await handler(removal(params), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [] });
}

const storedKeys = (state: State) => [...state.objects.keys()].sort();
const snapshot = (state: State) => ({ keys: storedKeys(state), revokedCandidateIds: [...state.revokedCandidateIds], crawlVersions: [...state.crawlVersions] });

describe("a redriven remove-my-content command resolves against the state as of the request", () => {
	it("a redrive keeps a capture the reader saved after asking, while the removed version is still logged", async () => {
		const state = createState({
			captures: [earlier, resaved],
			crawlVersions: [{ minuteId: REMOVED_VERSION, authorUserId: READER, candidateId: earlier.id }],
			canonicalCandidateId: earlier.id,
		});

		await redrive(state);

		expect(storedKeys(state)).toEqual([...resaved.keys].sort());
		expect(state.revokedCandidateIds).toEqual([earlier.id]);
		expect(state.crawlVersions).toEqual([]);
		expect(state.published).toEqual([ReselectAfterRemovalEvent.detailType]);
	});

	it("a redrive leaves a re-saved capture canonical after the removed version was pruned", async () => {
		const state = createState({
			captures: [resaved],
			crawlVersions: [],
			canonicalCandidateId: resaved.id,
			revokedCandidateIds: [earlier.id],
			extraKeys: [LEGACY_CANONICAL_KEY],
		});

		await redrive(state);

		expect(storedKeys(state)).toEqual([...resaved.keys].sort());
		expect(state.revokedCandidateIds).toEqual([earlier.id]);
		expect(state.published).toEqual([]);
	});

	it("a redrive finishes erasing older captures when a later version is logged", async () => {
		const laterVersion = { minuteId: RESAVED_VERSION, authorUserId: READER, candidateId: resaved.id };
		const state = createState({
			captures: [older, earlier, resaved],
			crawlVersions: [{ minuteId: REMOVED_VERSION, authorUserId: READER, candidateId: earlier.id }, laterVersion],
			canonicalCandidateId: resaved.id,
		});

		await redrive(state);

		expect(storedKeys(state)).toEqual([...resaved.keys].sort());
		expect([...state.revokedCandidateIds].sort()).toEqual([earlier.id, older.id].sort());
		expect(state.crawlVersions).toEqual([laterVersion]);
		expect(state.published).toEqual([]);
	});

	it("redriven twice after a re-save, the state after the second run equals the state after the first", async () => {
		const state = createState({
			captures: [earlier, resaved],
			crawlVersions: [{ minuteId: REMOVED_VERSION, authorUserId: READER, candidateId: earlier.id }],
			canonicalCandidateId: earlier.id,
		});

		await redrive(state);
		const afterFirst = snapshot(state);
		await redrive(state);

		expect(snapshot(state)).toEqual(afterFirst);
		expect(state.published).toEqual([ReselectAfterRemovalEvent.detailType, ReselectAfterRemovalEvent.detailType]);
	});

	it("redriven with no re-save, the removal completes as on first delivery", async () => {
		const state = createState({
			captures: [older, earlier],
			crawlVersions: [{ minuteId: REMOVED_VERSION, authorUserId: READER, candidateId: earlier.id }],
			canonicalCandidateId: earlier.id,
		});

		await redrive(state);

		expect(storedKeys(state)).toEqual([]);
		expect([...state.revokedCandidateIds].sort()).toEqual([earlier.id, older.id].sort());
		expect(state.crawlVersions).toEqual([]);
		expect(state.published).toEqual([RecrawlLinkInitiatedEvent.detailType]);
	});

	it("redriven after a later removal of the re-saved version, nothing more is erased", async () => {
		const state = createState({
			captures: [resaved],
			crawlVersions: [{ minuteId: RESAVED_VERSION, authorUserId: READER, candidateId: resaved.id }],
			canonicalCandidateId: resaved.id,
			revokedCandidateIds: [earlier.id],
		});
		await redrive(state, { time: "2026-07-16T10:10:00Z", versionMinuteId: RESAVED_VERSION });
		const afterLaterRemoval = snapshot(state);

		await redrive(state);

		expect(afterLaterRemoval).toEqual({ keys: [], revokedCandidateIds: [earlier.id, resaved.id], crawlVersions: [] });
		expect(snapshot(state)).toEqual(afterLaterRemoval);
	});

	it("redriven after the url was purged and saved again, the new capture stays", async () => {
		const savedAgain = capture({ id: "saved-again", at: "2026-07-16T10:20:00Z" });
		const savedAgainVersion = { minuteId: "2026-07-16T10:20Z", authorUserId: READER, candidateId: savedAgain.id };
		const state = createState({ captures: [savedAgain], crawlVersions: [savedAgainVersion], canonicalCandidateId: savedAgain.id });
		const beforeRedrive = snapshot(state);

		await redrive(state);

		expect(snapshot(state)).toEqual(beforeRedrive);
		expect(state.published).toEqual([]);
	});
});
