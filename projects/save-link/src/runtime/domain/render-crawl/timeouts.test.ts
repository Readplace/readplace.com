import assert from "node:assert/strict";
import { PROXIED_FETCH_TIMEOUTS } from "@packages/crawl-article";
import { RENDER_CRAWL_TIMEOUTS } from "./timeouts";

describe("RENDER_CRAWL_TIMEOUTS", () => {
	it("SQS visibility timeout is at least as long as the Lambda timeout", () => {
		assert.ok(RENDER_CRAWL_TIMEOUTS.sqsVisibilitySeconds >= RENDER_CRAWL_TIMEOUTS.lambdaSeconds);
	});

	it("a direct render, a residential render and the finalization reserve fit inside the Lambda timeout", () => {
		const t = RENDER_CRAWL_TIMEOUTS;
		const directRenderMs = t.directNavigationMs + t.renderOverheadMs;
		const residentialRenderMs = t.residentialNavigationMs + t.renderOverheadMs;
		assert.ok(directRenderMs + residentialRenderMs + t.finalizationReserveMs <= t.lambdaSeconds * 1000);
	});

	it("the web unlocker fetch reads its body for as long as the shared proxied fetch does", () => {
		assert.equal(RENDER_CRAWL_TIMEOUTS.webUnlockerFetch.bodyMs, PROXIED_FETCH_TIMEOUTS.bodyMs);
	});
});
