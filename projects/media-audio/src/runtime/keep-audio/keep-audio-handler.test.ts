import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { MediaProcessingFailedEvent, MediaUploadCommittedEvent, TierContentExtractedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { Logger, noopLogger } from "@packages/logger";
import { type Enclosure, stagedObjectKey } from "@packages/media-contracts";
import { objectKey, type RefObject, type UnrefAllForUpload } from "@packages/media-object-store";
import type { PutTierSource } from "@packages/tier-source";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import type { AudioStreamFacts } from "../probe/music-metadata-parse";
import { initWriteMinimalAudioBody } from "../minimal-body/write-minimal-audio-body";
import { initProbeMedia } from "../probe/probe-media";
import type { ReadStagedObject } from "../s3/s3-staged-object";
import { initKeepAudioHandler } from "./keep-audio-handler";

const DETAIL = MediaUploadCommittedEvent.detailSchema.parse({
	uploadId: "0123456789abcdef0123456789abcdef",
	kind: "audio",
	url: "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef",
	userId: "user-1",
	saveAttemptId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
	etag: '"etag"',
	attempt: 1,
});
const TIME = "2026-11-05T10:00:00Z";
const BYTES = Buffer.from("audio-bytes");
const SHA256 = createHash("sha256").update(BYTES).digest("hex");
const MP3: AudioStreamFacts = { container: "MPEG", codec: "MPEG 1 Layer 3", duration: 2819.6, hasAudio: true, hasVideo: false, title: undefined };

type Item = { media?: { fileName: string } } | undefined;

function setUp(overrides: { facts?: AudioStreamFacts | "unrecognised"; staged?: Awaited<ReturnType<ReadStagedObject>>; item?: Item; enclosure?: "recorded" | "not-found"; unrefAll?: UnrefAllForUpload } = {}) {
	const state = { item: "item" in overrides ? overrides.item : { media: { fileName: "episode-12.mp3" } } };
	const published: { event: string; detail: unknown }[] = [];
	const stagedReads: Parameters<ReadStagedObject>[0][] = [];
	const copies: { stagedKey: string; etag: string; targetKey: string }[] = [];
	const enclosures: { url: string; enclosure: Enclosure }[] = [];
	const tierSources: Parameters<PutTierSource>[0][] = [];
	const unrefs: { uploadId: string }[] = [];
	const provenanceAttempts: string[] = [];
	const holdings = new Set<string>();
	const ref: RefObject = async ({ sha256, uploadId, putBytes }) => {
		const key = objectKey({ sha256, generation: 1 });
		if (!holdings.has(`${sha256}/${uploadId}`)) await putBytes(key);
		holdings.add(`${sha256}/${uploadId}`);
		return { sha256, generation: 1, key };
	};
	const publishEvent: PublishEvent = async (event, detail) => {
		published.push({ event: event.detailType, detail: event.detailSchema.parse(detail) });
	};
	const handler = initKeepAudioHandler({
		findArticleMedia: async () => state.item,
		readStagedObject: async (params) => {
			stagedReads.push(params);
			return overrides.staged ?? { body: Readable.from([BYTES]), contentLength: BYTES.length };
		},
		copyStagedTo: async (params) => {
			copies.push(params);
		},
		probeMedia: initProbeMedia({ parseAudioStream: async () => overrides.facts ?? MP3 }),
		mediaObjects: {
			ref,
			unrefAll:
				overrides.unrefAll ??
				(async (params) => {
					unrefs.push(params);
				}),
		},
		setArticleEnclosure: async (params) => {
			enclosures.push(params);
			return overrides.enclosure ?? "recorded";
		},
		writeMinimalAudioBody: initWriteMinimalAudioBody({
			putTierSource: async (params) => {
				tierSources.push(params);
				provenanceAttempts.push(params.metadata.attemptId);
				return params.metadata;
			},
			publishEvent,
		}),
		publishEvent,
		logger: Logger.from(noopLogger),
	});
	const run = (body: unknown = { time: TIME, detail: DETAIL }) =>
		handler(buildSqsEvent([{ messageId: "m-1", body: JSON.stringify(body) }]), buildLambdaContext(), () => {});
	return { run, state, published, stagedReads, copies, enclosures, tierSources, unrefs, provenanceAttempts };
}

function expectedFailure(reason: "staged-bytes-gone" | "unreadable", notice: string) {
	const { uploadId, kind, url, saveAttemptId, attempt } = DETAIL;
	return [{ event: "MediaProcessingFailed", detail: MediaProcessingFailedEvent.detailSchema.parse({ uploadId, kind, url, saveAttemptId, attempt, reason, notice }) }];
}

const UNREADABLE = "We couldn't read this audio file. Upload an MP3 or M4A that plays on your device.";

describe("initKeepAudioHandler", () => {
	it("keeps an MP3 under its digest, records its enclosure, writes the tier-0 body bound to this save's attempt, then announces it", async () => {
		const { run, published, stagedReads, copies, enclosures, tierSources, provenanceAttempts } = setUp();

		assert.deepEqual(await run(), { batchItemFailures: [] });

		const key = `objects/sha256/${SHA256}/1`;
		assert.deepEqual(stagedReads, [{ key: stagedObjectKey(DETAIL.uploadId), etag: DETAIL.etag }]);
		assert.deepEqual(copies, [{ stagedKey: stagedObjectKey(DETAIL.uploadId), etag: DETAIL.etag, targetKey: key }]);
		assert.deepEqual(enclosures, [{ url: DETAIL.url, enclosure: { object: key, mediaType: "audio/mpeg", durationSeconds: 2820 } }]);
		assert.equal(tierSources.length, 1);
		const [source] = tierSources;
		assert.equal(source.tier, "tier-0");
		assert.equal(source.url, DETAIL.url);
		assert.match(source.html, /47 minutes/);
		assert.match(source.html, /File: episode-12\.mp3/);
		assert.equal(source.metadata.title, "episode-12");
		assert.equal(source.metadata.estimatedReadTime, 47);
		assert.equal(source.metadata.authorUserId, DETAIL.userId);
		assert.equal(source.metadata.fetchedAt, TIME);
		assert.deepEqual(provenanceAttempts, [DETAIL.saveAttemptId]);
		assert.deepEqual(published, [
			{
				event: "TierContentExtracted",
				detail: TierContentExtractedEvent.detailSchema.parse({
					url: DETAIL.url,
					saveAttemptId: DETAIL.saveAttemptId,
					candidates: [{ id: source.metadata.id, tier: "tier-0" }],
					userId: DETAIL.userId,
					extractedAt: TIME,
				}),
			},
		]);
	});

	it("records an M4A as audio/mp4", async () => {
		const m4a = Buffer.from("\0\0\0\x1cftypM4A mdat");
		const { run, enclosures } = setUp({ facts: { ...MP3, container: "M4A/isom/iso2", codec: "MPEG-4/AAC" }, staged: { body: Readable.from([m4a]), contentLength: m4a.length } });

		await run();

		assert.equal(enclosures[0].enclosure.mediaType, "audio/mp4");
	});

	it("leaves the File line out for an upload without a file name and titles it by its tag", async () => {
		const { run, tierSources } = setUp({ item: { media: { fileName: "Audio upload" } }, facts: { ...MP3, title: "Episode 12" } });

		await run();

		assert.doesNotMatch(tierSources[0].html, /File:/);
		assert.equal(tierSources[0].metadata.title, "Episode 12");
	});

	it.each([
		["the staged bytes are gone", { staged: "staged-bytes-gone" as const }, "staged-bytes-gone" as const, "We couldn't find the file you uploaded. Please upload it again."],
		["no parser recognises the file", { facts: "unrecognised" as const }, "unreadable" as const, UNREADABLE],
		["the file has a video track", { facts: { ...MP3, hasVideo: true } }, "unreadable" as const, UNREADABLE],
		["the file has no duration", { facts: { ...MP3, duration: undefined } }, "unreadable" as const, UNREADABLE],
	])("publishes the failure when %s, and keeps nothing", async (_, overrides, reason, notice) => {
		const { run, published, copies, enclosures, tierSources } = setUp(overrides);

		assert.deepEqual(await run(), { batchItemFailures: [] });

		assert.deepEqual(published, expectedFailure(reason, notice));
		assert.deepEqual(copies, []);
		assert.deepEqual(enclosures, []);
		assert.deepEqual(tierSources, []);
	});

	it("releases the upload's holdings and announces nothing when the item was released while the audio was processing", async () => {
		const { run, published, tierSources, unrefs } = setUp({ enclosure: "not-found" });

		assert.deepEqual(await run(), { batchItemFailures: [] });

		assert.deepEqual(unrefs, [{ uploadId: DETAIL.uploadId }]);
		assert.deepEqual(tierSources, []);
		assert.deepEqual(published, []);
	});

	it("releases the upload's holdings without reading the staged bytes when the item is missing or tombstoned", async () => {
		const { run, published, stagedReads, unrefs } = setUp({ item: undefined });

		assert.deepEqual(await run(), { batchItemFailures: [] });

		assert.deepEqual(unrefs, [{ uploadId: DETAIL.uploadId }]);
		assert.deepEqual(stagedReads, []);
		assert.deepEqual(published, []);
	});

	it("fails the record when releasing a released item rejects, and its redelivery releases again from the item check", async () => {
		const releases: { uploadId: string }[] = [];
		const { run, state, published, stagedReads } = setUp({
			enclosure: "not-found",
			unrefAll: async (params) => {
				releases.push(params);
				if (releases.length === 1) throw new Error("throttled");
			},
		});

		assert.deepEqual(await run(), { batchItemFailures: [{ itemIdentifier: "m-1" }] });
		state.item = undefined;
		assert.deepEqual(await run(), { batchItemFailures: [] });

		assert.deepEqual(releases, [{ uploadId: DETAIL.uploadId }, { uploadId: DETAIL.uploadId }]);
		assert.equal(stagedReads.length, 1);
		assert.deepEqual(published, []);
	});

	it("copies the bytes at most once across a redelivery", async () => {
		const { run, copies, published } = setUp();

		await run();
		await run();

		assert.equal(copies.length, 1);
		assert.equal(published.length, 2);
	});

	it("fails the record for a malformed message so the queue retries it", async () => {
		const { run, published } = setUp();

		assert.deepEqual(await run({ time: TIME, detail: { uploadId: "x" } }), { batchItemFailures: [{ itemIdentifier: "m-1" }] });
		assert.deepEqual(published, []);
	});

	it("records the enclosure of a charged upload and leaves its body to transcription", async () => {
		const { run, published, enclosures, tierSources } = setUp();

		assert.deepEqual(await run({ time: TIME, detail: { ...DETAIL, chargedSeconds: 600 } }), { batchItemFailures: [] });

		assert.equal(enclosures.length, 1);
		assert.deepEqual(tierSources, []);
		assert.deepEqual(published, []);
	});
});
