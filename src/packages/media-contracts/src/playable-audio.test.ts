import assert from "node:assert/strict";
import { isPlayableAudio } from "./playable-audio";

const PLAYABLE = { durationSeconds: 600, hasAudio: true, hasVideo: false };

describe("isPlayableAudio", () => {
	it("accepts an audio-only file of at least a second", () => {
		assert.equal(isPlayableAudio(PLAYABLE), true);
		assert.equal(isPlayableAudio({ ...PLAYABLE, durationSeconds: 1 }), true);
	});

	it.each([
		["no audio track", { ...PLAYABLE, hasAudio: false }],
		["a video track", { ...PLAYABLE, hasVideo: true }],
		["under a second", { ...PLAYABLE, durationSeconds: 0.5 }],
	])("rejects a file with %s", (_label, facts) => {
		assert.equal(isPlayableAudio(facts), false);
	});
});
