import assert from "node:assert/strict";
import { UPLOAD_REFUSAL_COPY, uploadRefusalMessage } from "./upload.refusal";

describe("uploadRefusalMessage", () => {
	it("names the refusal the redirect carried", () => {
		assert.equal(uploadRefusalMessage({ refused: "transcript-quota" }), UPLOAD_REFUSAL_COPY["transcript-quota"]);
	});

	it("tells the reader a video without sound has nothing to transcribe", () => {
		assert.equal(
			uploadRefusalMessage({ refused: "no-audio-track" }),
			"This video has no audio track, so there is nothing to transcribe. Upload a video with sound.",
		);
	});

	it("shows nothing for a missing or unknown reason", () => {
		assert.equal(uploadRefusalMessage({}), undefined);
		assert.equal(uploadRefusalMessage({ refused: "something-else" }), undefined);
	});
});
