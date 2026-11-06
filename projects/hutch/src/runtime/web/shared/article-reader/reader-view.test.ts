import assert from "node:assert/strict";
import { offersSaveTip, readerContentUnavailable, readerNoticeOf, type ReaderView } from "./reader-view";

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
