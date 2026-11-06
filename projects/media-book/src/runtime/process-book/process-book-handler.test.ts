import assert from "node:assert/strict";
import { MediaUploadCommittedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { PutTierSource } from "@packages/tier-source";
import { buildTestEpub } from "../epub/build-test-epub";
import type { DownloadStagedObject } from "../s3/download-staged-object";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { ReaderArticleHashId } from "@packages/domain/article";
import type { PutBookImage } from "../s3/put-book-image";
import { initProcessBookHandler } from "./process-book-handler";
import { initStoreBookImage } from "./store-book-image";

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
const ILLUSTRATED_BOOK = buildTestEpub({
	title: "Pictures",
	chapters: [{ file: "text/one.xhtml", title: "One", body: `<p>see</p><img src="../images/a.png"/><img src="../images/missing.png"/>` }],
	images: [{ file: "images/a.png", mediaType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]) }],
});
const BOOK = buildTestEpub({ title: "A Book", authors: ["Ada"], chapters: [{ file: "one.xhtml", title: "One", body: "<p>hello world</p>" }] });
const LONG_BOOK = buildTestEpub({
	title: "Long",
	chapters: [
		{ file: "one.xhtml", title: "One", body: `<p>${"a".repeat(1_000)}</p>` },
		{ file: "two.xhtml", title: "Two", body: `<p>${"b".repeat(1_000)}</p>` },
	],
});
const TOO_LARGE_NOTICE = "This book is too large to read or export. Split it into smaller EPUB files and upload each one.";

function sqsEvent(body: unknown) {
	return buildSqsEvent([{ messageId: "m-1", body: JSON.stringify(body) }]);
}

type Limits = { readerBodyByteLimit?: number; wholeBodyByteLimit?: number; largestSectionByteLimit?: number };

function setUp(overrides: { download?: DownloadStagedObject; sections?: "recorded" | "not-found"; limits?: Limits } = {}) {
	const published: { event: string; detail: unknown }[] = [];
	const tierSources: Parameters<PutTierSource>[0][] = [];
	const sectionWrites: { url: string; sectionCount: number }[] = [];
	const puts: Parameters<PutBookImage>[0][] = [];
	const infoLines: unknown[][] = [];
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
		storeBookImagesFor: initStoreBookImage({
			putBookImage: async (input) => {
				puts.push(input);
			},
		}),
		publishEvent,
		readerBodyByteLimit: 1_000_000,
		wholeBodyByteLimit: 2_000_000,
		largestSectionByteLimit: 1_000_000,
		...overrides.limits,
		logger: HutchLogger.from({ ...noopLogger, info: (...args: unknown[]) => infoLines.push(args) }),
	});
	const run = (body: unknown = { time: TIME, detail: DETAIL }) => handler(sqsEvent(body), buildLambdaContext(), () => {});
	return { run, published, tierSources, sectionWrites, puts, infoLines };
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

	it("stores the book's images under this upload and points the tier-0 body at the owner's media route", async () => {
		const { run, tierSources, puts } = setUp({ download: async () => ({ bytes: ILLUSTRATED_BOOK, sha256: "sha" }) });

		assert.deepEqual(await run(), { batchItemFailures: [] });

		const routeId = ReaderArticleHashId.from(DETAIL.url).value;
		assert.match(tierSources[0].html, new RegExp(`<img loading="lazy" src="/queue/${routeId}/media/[0-9a-f]{64}\\.png">`));
		assert.equal((tierSources[0].html.match(/<img/g) ?? []).length, 1);
		assert.deepEqual(puts.map((put) => [put.uploadId, put.contentType]), [[DETAIL.uploadId, "image/png"]]);
	});

	it("names a book without an author by its kind", async () => {
		const { run, tierSources } = setUp({ download: async () => ({ bytes: buildTestEpub({ chapters: [{ file: "a.xhtml", title: "A", body: "<p>x</p>" }] }), sha256: "sha" }) });

		await run();

		assert.equal(tierSources[0].metadata.siteName, "Book");
	});

	it("writes nothing and announces nothing when the item was released while the book was processing, and logs the images it left", async () => {
		const { run, published, tierSources, infoLines } = setUp({ sections: "not-found", download: async () => ({ bytes: ILLUSTRATED_BOOK, sha256: "sha" }) });

		assert.deepEqual(await run(), { batchItemFailures: [] });

		assert.deepEqual(tierSources, []);
		assert.deepEqual(published, []);
		assert.deepEqual(infoLines, [["[process-book] item released while processing", { uploadId: DETAIL.uploadId, imagesWritten: 1 }]]);
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
		["the body is over the whole-body limit", { limits: { wholeBodyByteLimit: 10 } }, "too-large-for-reader", TOO_LARGE_NOTICE],
		[
			"the body is over one reader page and its largest page cannot fit on one",
			{ download: async () => ({ bytes: LONG_BOOK, sha256: "sha" }), limits: { readerBodyByteLimit: 1_500, largestSectionByteLimit: 1_000 } },
			"too-large-for-reader",
			TOO_LARGE_NOTICE,
		],
	])("publishes the failure when %s, and writes no source", async (_, overrides, reason, notice) => {
		const { run, published, tierSources, sectionWrites } = setUp(overrides);

		assert.deepEqual(await run(), { batchItemFailures: [] });

		assert.deepEqual(failureOf(published), expectedFailure(reason, notice));
		assert.deepEqual(tierSources, []);
		assert.deepEqual(sectionWrites, []);
	});

	it.each([
		["over one reader page whose every chapter fits on a page", { download: async () => ({ bytes: LONG_BOOK, sha256: "sha" }), limits: { readerBodyByteLimit: 1_500, largestSectionByteLimit: 1_500 } }],
		["within one reader page even when that page is over the page limit", { limits: { largestSectionByteLimit: 10 } }],
	])("accepts a body %s", async (_, overrides) => {
		const { run, published, tierSources } = setUp(overrides);

		assert.deepEqual(await run(), { batchItemFailures: [] });

		assert.equal(tierSources.length, 1);
		assert.deepEqual(published.map(({ event }) => event), ["TierContentExtracted"]);
	});

	it("fails the record for a malformed message so the queue retries it", async () => {
		const { run, published } = setUp();

		assert.deepEqual(await run({ time: TIME, detail: { uploadId: "x" } }), { batchItemFailures: [{ itemIdentifier: "m-1" }] });
		assert.deepEqual(published, []);
	});
});
