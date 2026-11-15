import assert from "node:assert/strict";
import { bookQuotaMessageOf, bookQuotaRedirectQueryOf, uploadRefusalCopyOf, uploadRefusalOf } from "./upload.refusal";

describe("uploadRefusalOf", () => {
	it("names the refusal the redirect carried", () => {
		assert.deepEqual(uploadRefusalOf({ query: { refused: "transcript-quota" }, allowanceSeconds: 1200 }), {
			reason: "transcript-quota",
			message: "You've used your 20 minutes of transcript for today. It resets at 00:00 UTC.",
		});
	});

	it("tells the reader a video without sound has nothing to transcribe", () => {
		assert.deepEqual(uploadRefusalOf({ query: { refused: "no-audio-track" }, allowanceSeconds: 1200 }), {
			reason: "no-audio-track",
			message: "This video has no sound, so there's nothing to transcribe.",
		});
	});

	it("carries the instant a book-quota refusal lifts as a local time", () => {
		assert.deepEqual(
			uploadRefusalOf({
				query: { refused: "book-quota", retry_at: "2026-11-14T00:00:00.000Z" },
				allowanceSeconds: 1200,
			}),
			{
				reason: "book-quota",
				retryAt: { iso: "2026-11-14T00:00:00.000Z", label: "Nov 14, 2026, 00:00 UTC", mode: "datetime" },
			},
		);
	});

	it("shows nothing for a book-quota refusal without a valid retry instant", () => {
		assert.equal(uploadRefusalOf({ query: { refused: "book-quota" }, allowanceSeconds: 1200 }), undefined);
		assert.equal(
			uploadRefusalOf({ query: { refused: "book-quota", retry_at: "tomorrow" }, allowanceSeconds: 1200 }),
			undefined,
		);
	});

	it("shows nothing for a missing or unknown reason", () => {
		assert.equal(uploadRefusalOf({ query: {}, allowanceSeconds: 1200 }), undefined);
		assert.equal(uploadRefusalOf({ query: { refused: "something-else" }, allowanceSeconds: 1200 }), undefined);
	});
});

describe("bookQuotaMessageOf", () => {
	it("tells the reader when they can upload another book", () => {
		assert.equal(
			bookQuotaMessageOf(new Date("2026-11-14T00:00:00.000Z")),
			"You've reached today's limit for book uploads. You can upload another book after Nov 14, 2026, 00:00 UTC.",
		);
	});
});

describe("bookQuotaRedirectQueryOf", () => {
	it("carries the reason and the retry instant", () => {
		assert.equal(
			bookQuotaRedirectQueryOf(new Date("2026-11-14T00:00:00.000Z")),
			"refused=book-quota&retry_at=2026-11-14T00%3A00%3A00.000Z",
		);
	});
});

describe("uploadRefusalCopyOf", () => {
	it("names the reader's own daily allowance in whole minutes", () => {
		const copy = uploadRefusalCopyOf(45 * 60 + 30);
		assert.equal(copy["transcript-quota"], "You've used your 45 minutes of transcript for today. It resets at 00:00 UTC.");
		assert.equal(
			copy["transcript-too-long"],
			"This file is longer than your 45 minutes of transcript a day. Split it into parts of 45 minutes or less.",
		);
	});

	it("tells the reader Readplace couldn't read an unreadable audio file", () => {
		assert.equal(
			uploadRefusalCopyOf(1200)["unreadable-audio"],
			"Readplace couldn't read this audio file. Upload an MP3 or M4A that plays on your device.",
		);
	});
});
