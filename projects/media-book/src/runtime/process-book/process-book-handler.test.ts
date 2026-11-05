import assert from "node:assert/strict";
import { MediaUploadCommittedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { PutTierSource } from "@packages/tier-source";
import { buildTestEpub } from "../epub/build-test-epub";
import type { DownloadStagedObject } from "../s3/download-staged-object";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initProcessBookHandler } from "./process-book-handler";

const DETAIL = MediaUploadCommittedEvent.detailSchema.parse({
	uploadId: "0123456789abcdef0123456789abcdef",
	kind: "book",
	url: "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef",
	userId: "user-1",
	saveAttemptId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
	etag: '"etag"',
	attempt: 1,
});
const TIME = "2026-11-05T10:00:00Z";
const BOOK = buildTestEpub({ title: "A Book", authors: ["Ada"], chapters: [{ file: "one.xhtml", title: "One", body: "<p>hello world</p>" }] });

function sqsEvent(body: unknown) {
	return buildSqsEvent([{ messageId: "m-1", body: JSON.stringify(body) }]);
}

function setUp(overrides: { download?: DownloadStagedObject; sections?: "recorded" | "not-found"; limit?: number } = {}) {
	const published: { event: string; detail: unknown }[] = [];
	const tierSources: Parameters<PutTierSource>[0][] = [];
	const sectionWrites: { url: string; sectionCount: number }[] = [];
	const publishEvent: PublishEvent = async (event, detail) => {
		published.push({ event: event.detailType, detail });
	};
	const handler = initProcessBookHandler({
		downloadStagedObject: overrides.download ?? (async () => ({ bytes: BOOK, sha256: "sha" })),
		recordPrivateItemSections: async (params) => {
			sectionWrites.push(params);
			return overrides.sections ?? "recorded";
		},
		putTierSource: async (params) => {
			tierSources.push(params);
		},
		publishEvent,
		readerBodyByteLimit: overrides.limit ?? 1_000_000,
		logger: HutchLogger.from(noopLogger),
	});
	const run = (body: unknown = { time: TIME, detail: DETAIL }) => handler(sqsEvent(body), buildLambdaContext(), () => {});
	return { run, published, tierSources, sectionWrites };
}

function failureOf(published: { event: string; detail: unknown }[]) {
	return published.map(({ event, detail }) => ({ event, detail }));
}

function expectedFailure(reason: string, notice: string) {
	const { uploadId, kind, url, saveAttemptId, attempt } = DETAIL;
	return [{ event: "MediaProcessingFailed", detail: { uploadId, kind, url, saveAttemptId, attempt, reason, notice } }];
}

describe("initProcessBookHandler", () => {
	it("records the sections, writes the tier-0 source bound to this save's attempt, then announces it", async () => {
		const { run, published, tierSources, sectionWrites } = setUp();

		assert.deepEqual(await run(), { batchItemFailures: [] });

		assert.deepEqual(sectionWrites, [{ url: DETAIL.url, sectionCount: 1 }]);
		assert.equal(tierSources.length, 1);
		const [source] = tierSources;
		assert.equal(source.tier, "tier-0");
		assert.equal(source.url, DETAIL.url);
		assert.match(source.html, /<h2 id="section-ch-1">One<\/h2><p>hello world<\/p>/);
		assert.equal(source.metadata.title, "A Book");
		assert.equal(source.metadata.siteName, "Ada");
		assert.equal(source.metadata.wordCount, 2);
		assert.equal(source.metadata.authorUserId, DETAIL.userId);
		assert.equal(source.metadata.attemptId, DETAIL.saveAttemptId);
		assert.equal(source.metadata.captureTrigger, undefined);
		assert.equal(source.metadata.fetchedAt, TIME);
		assert.deepEqual(published, [
			{
				event: "TierContentExtracted",
				detail: { url: DETAIL.url, saveAttemptId: DETAIL.saveAttemptId, candidates: [{ id: source.metadata.id, tier: "tier-0" }], userId: DETAIL.userId, extractedAt: TIME },
			},
		]);
	});

	it("names a book without an author by its kind", async () => {
		const { run, tierSources } = setUp({ download: async () => ({ bytes: buildTestEpub({ chapters: [{ file: "a.xhtml", title: "A", body: "<p>x</p>" }] }), sha256: "sha" }) });

		await run();

		assert.equal(tierSources[0].metadata.siteName, "Book");
	});

	it("writes nothing and announces nothing when the item was released while the book was processing", async () => {
		const { run, published, tierSources } = setUp({ sections: "not-found" });

		assert.deepEqual(await run(), { batchItemFailures: [] });

		assert.deepEqual(tierSources, []);
		assert.deepEqual(published, []);
	});

	it.each([
		["the staged bytes are gone", { download: async () => "staged-bytes-gone" as const }, "staged-bytes-gone", "We couldn't find the file you uploaded. Please upload it again."],
		["the file is not a zip", { download: async () => ({ bytes: new TextEncoder().encode("plain text"), sha256: "sha" }) }, "unreadable", "This file isn't an EPUB we can read. Check the file and upload it again."],
		["the zip is not an EPUB", { download: async () => ({ bytes: buildTestEpub({ chapters: [] }), sha256: "sha" }) }, "unreadable", "This file isn't an EPUB we can read. Check the file and upload it again."],
		[
			"the book is DRM protected",
			{ download: async () => ({ bytes: buildTestEpub({ chapters: [{ file: "a.xhtml", title: "A", body: "" }], extraFiles: { "META-INF/encryption.xml": `<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>` } }), sha256: "sha" }) },
			"unreadable",
			"This book is protected by DRM, so we can't open it. Upload a DRM-free copy.",
		],
		["the body is over the reader limit", { limit: 10 }, "too-large-for-reader", "This book is too large to show in the reader."],
	])("publishes the failure when %s, and writes no source", async (_, overrides, reason, notice) => {
		const { run, published, tierSources, sectionWrites } = setUp(overrides);

		assert.deepEqual(await run(), { batchItemFailures: [] });

		assert.deepEqual(failureOf(published), expectedFailure(reason, notice));
		assert.deepEqual(tierSources, []);
		assert.deepEqual(sectionWrites, []);
	});

	it("fails the record for a malformed message so the queue retries it", async () => {
		const { run, published } = setUp();

		assert.deepEqual(await run({ time: TIME, detail: { uploadId: "x" } }), { batchItemFailures: [{ itemIdentifier: "m-1" }] });
		assert.deepEqual(published, []);
	});
});
