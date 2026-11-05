import assert from "node:assert/strict";
import { resolutionOnViewCoolDownCutoff } from "./resolution-on-view-cool-down";

describe("resolutionOnViewCoolDownCutoff", () => {
	it("puts the cut-off 24 hours before now", () => {
		assert.equal(resolutionOnViewCoolDownCutoff(new Date("2026-11-05T12:00:00.000Z")), "2026-11-04T12:00:00.000Z");
	});
});
