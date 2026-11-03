import assert from "node:assert/strict";
import { MediaFailureReasonSchema } from "./media-failure";

describe("MediaFailureReasonSchema", () => {
	it.each(["staged-bytes-gone", "unreadable", "processing-exhausted", "too-large-for-reader"])(
		"accepts %s",
		(reason) => {
			assert.equal(MediaFailureReasonSchema.parse(reason), reason);
		},
	);

	it("refuses a reason it does not name", () => {
		assert.equal(MediaFailureReasonSchema.safeParse("drm-protected").success, false);
	});
});
