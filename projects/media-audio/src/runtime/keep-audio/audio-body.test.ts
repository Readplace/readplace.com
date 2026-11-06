import assert from "node:assert/strict";
import { buildAudioBody } from "./audio-body";

describe("buildAudioBody", () => {
	it("says minute, not minutes, for a one-minute file", () => {
		const body = buildAudioBody({ title: "Intro", fileName: "intro.mp3", minutes: 1 });

		assert.equal(body.excerpt, "Audio, 1 minute.");
	});
});
