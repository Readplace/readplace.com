import assert from "node:assert/strict";
import { ANONYMOUS_VIEWER, ItemMediaSchema, storedArticleBody } from "@packages/domain/article";
import { isReaderViewShareable, offersSaveTip, readerContentUnavailable, readerNoticeOf, type ReaderView, transcriptNoticeOf } from "./reader-view";

const notAnArticle: ReaderView = { kind: "not-an-article" };
const loading: ReaderView = { kind: "loading" };
const succeeded: ReaderView = { kind: "succeeded" };
const failedWithContent: ReaderView = { kind: "failed", contentUnavailable: false };
const failedWithoutContent: ReaderView = { kind: "failed", contentUnavailable: true };

describe("offersSaveTip", () => {
	it("offers the save tip only for a failed reader view", () => {
		assert.deepEqual(
			[notAnArticle, loading, succeeded, failedWithContent, failedWithoutContent].map(offersSaveTip),
			[false, false, false, true, true],
		);
	});
});

describe("readerContentUnavailable", () => {
	it("marks the content unavailable for a non-article and for a failure without content", () => {
		assert.deepEqual(
			[notAnArticle, loading, succeeded, failedWithContent, failedWithoutContent].map(readerContentUnavailable),
			[true, false, false, false, true],
		);
	});
});

describe("readerNoticeOf", () => {
	it("gives the not-an-article notice only for a non-article", () => {
		assert.deepEqual(
			[notAnArticle, loading, succeeded, failedWithContent, failedWithoutContent].map(readerNoticeOf),
			["not-an-article", undefined, undefined, undefined, undefined],
		);
	});
});

describe("transcriptNoticeOf", () => {
	const audio = ItemMediaSchema.parse({ kind: "audio", fileName: "episode-12.mp3", routeId: "0123456789abcdef0123456789abcdef" });

	it("gives each recorded transcript outcome its own notice", () => {
		assert.deepEqual(
			[
				transcriptNoticeOf({ ...audio, transcript: "no-speech" }),
				transcriptNoticeOf({ ...audio, transcript: "transcript-failed" }),
			],
			["no-speech", "transcript-failed"],
		);
	});

	it("gives no notice to an item without media or without a recorded outcome", () => {
		assert.deepEqual([transcriptNoticeOf(undefined), transcriptNoticeOf(audio)], [undefined, undefined]);
	});
});

describe("isReaderViewShareable", () => {
	const stored = storedArticleBody({ url: "https://example.com/post", html: "<p>The article.</p>", viewer: ANONYMOUS_VIEWER, ownerUserId: undefined });
	assert(stored.kind === "article", "the fixture stores an article body");
	const content = stored.body;

	it("shares the reader view only when there is content and the crawl, if any, is ready", () => {
		assert.deepEqual(
			[
				{ content, crawl: undefined },
				{ content, crawl: { status: "ready" } as const },
				{ content, crawl: { status: "pending", startedAt: "2026-11-14T00:00:00.000Z" } as const },
				{ content, crawl: { status: "failed", reason: "blocked", outcomeRevision: 1 } as const },
				{ content, crawl: { status: "unsupported", reason: "pdf" } as const },
				{ content: undefined, crawl: undefined },
				{ content: undefined, crawl: { status: "ready" } as const },
			].map(isReaderViewShareable),
			[true, true, false, false, false, false, false],
		);
	});
});
