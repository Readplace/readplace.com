import assert from "node:assert/strict";
import { AUDIO } from "./audio";
import { isIsoBaseMediaFile } from "./iso-base-media-file";
import { VIDEO } from "./video";

describe("VIDEO", () => {
	it("accepts MP4 files up to 2 GB", () => {
		assert.deepEqual(VIDEO.accepts, { "video/mp4": [".mp4"] });
		assert.equal(VIDEO.uploadCeilingBytes, 2 * 1024 ** 3);
		assert.equal(VIDEO.ceilingLabel, "2 GB");
	});

	it("sniffs with the ISO base media file check", () => {
		assert.equal(VIDEO.sniff, isIsoBaseMediaFile);
	});

	it("meters transcript seconds and shares the audio listen time", () => {
		assert.equal(VIDEO.meter, "transcript-seconds");
		assert.equal(VIDEO.listenTime, AUDIO.listenTime);
	});

	it("allows a video with an audio track of at least one second", () => {
		assert.equal(
			VIDEO.refuseTimedFacts({ durationSeconds: 1, hasAudio: true, hasVideo: true }),
			undefined,
		);
	});

	it("refuses a video with no audio track", () => {
		assert.equal(
			VIDEO.refuseTimedFacts({ durationSeconds: 60, hasAudio: false, hasVideo: true }),
			"no-audio-track",
		);
	});

	it("refuses a video shorter than one second", () => {
		assert.equal(
			VIDEO.refuseTimedFacts({ durationSeconds: 0.5, hasAudio: true, hasVideo: true }),
			"unreadable-audio",
		);
	});
});
