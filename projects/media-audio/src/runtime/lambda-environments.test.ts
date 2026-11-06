import assert from "node:assert/strict";
import { KEEP_AUDIO_ENV } from "./keep-audio.env";
import { MEDIA_AUDIO_FAILURES_DLQ_ENV } from "./media-audio-failures-dlq.env";

const tuples = {
	KEEP_AUDIO_ENV,
	MEDIA_AUDIO_FAILURES_DLQ_ENV,
};

describe("Lambda environment tuples", () => {
	for (const [name, names] of Object.entries(tuples)) {
		it(`${name} names each variable once`, () => {
			assert.equal(new Set(names).size, names.length);
		});
	}
});
