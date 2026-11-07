import assert from "node:assert/strict";
import { isMeteredStart, uploadStartPathOf } from "./upload-features";

describe("isMeteredStart", () => {
	it("turns metering on when the features list names transcripts", () => {
		assert.equal(isMeteredStart({ features: "transcripts" }), true);
		assert.equal(isMeteredStart({ features: "other,transcripts" }), true);
	});

	it("leaves metering off without the flag or with another feature", () => {
		assert.equal(isMeteredStart({}), false);
		assert.equal(isMeteredStart({ features: "other" }), false);
		assert.equal(isMeteredStart({ features: ["transcripts"] }), false);
	});
});

describe("uploadStartPathOf", () => {
	it("keeps the flag on the start path of a metered upload only", () => {
		assert.equal(uploadStartPathOf(true), "/upload?features=transcripts");
		assert.equal(uploadStartPathOf(false), "/upload");
	});
});
