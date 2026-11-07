import assert from "node:assert/strict";
import { ARTICLE_REFRESH_DEADLINE_MS } from "./article-refresh-deadline";
import { resolutionOnViewCoolDownCutoff } from "./resolution-on-view-cool-down";

describe("resolutionOnViewCoolDownCutoff", () => {
	it("puts the cut-off 24 hours before now", () => {
		assert.equal(resolutionOnViewCoolDownCutoff(new Date("2026-11-05T12:00:00.000Z")), "2026-11-04T12:00:00.000Z");
	});

	it("puts the cut-off one article refresh deadline before now", () => {
		const now = new Date("2026-11-05T12:00:00.000Z");
		assert.equal(resolutionOnViewCoolDownCutoff(now), new Date(now.getTime() - ARTICLE_REFRESH_DEADLINE_MS).toISOString());
	});
});
