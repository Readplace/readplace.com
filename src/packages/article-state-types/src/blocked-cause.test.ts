import assert from "node:assert/strict";
import { blockedCauseForStatus } from "./blocked-cause";

describe("blockedCauseForStatus", () => {
	it("records a 429 as rate-limited, the condition the status is defined for", () => {
		assert.equal(blockedCauseForStatus(429), "rate-limited");
	});

	it("records a refusal of this egress as an edge block", () => {
		assert.equal(blockedCauseForStatus(403), "edge-block");
		assert.equal(blockedCauseForStatus(401), "edge-block");
		assert.equal(blockedCauseForStatus(406), "edge-block");
		assert.equal(blockedCauseForStatus(451), "edge-block");
		assert.equal(blockedCauseForStatus(498), "edge-block");
	});
});
