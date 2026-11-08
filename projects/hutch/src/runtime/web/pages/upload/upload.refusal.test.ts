import assert from "node:assert/strict";
import { uploadRefusalCopyOf, uploadRefusalMessage } from "./upload.refusal";

describe("uploadRefusalMessage", () => {
	it("names the refusal the redirect carried", () => {
		assert.equal(
			uploadRefusalMessage({ query: { refused: "transcript-quota" }, allowanceSeconds: 1200 }),
			"You've used your 20 minutes of transcript for today. It resets at 00:00 UTC.",
		);
	});

	it("tells the reader a video without sound has nothing to transcribe", () => {
		assert.equal(
			uploadRefusalMessage({ query: { refused: "no-audio-track" }, allowanceSeconds: 1200 }),
			"This video has no sound, so there's nothing to transcribe.",
		);
	});

	it("shows nothing for a missing or unknown reason", () => {
		assert.equal(uploadRefusalMessage({ query: {}, allowanceSeconds: 1200 }), undefined);
		assert.equal(uploadRefusalMessage({ query: { refused: "something-else" }, allowanceSeconds: 1200 }), undefined);
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
