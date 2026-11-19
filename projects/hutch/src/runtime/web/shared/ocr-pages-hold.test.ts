import assert from "node:assert/strict";
import { shownOcrPagesHold } from "./ocr-pages-hold";

const HOLD = { pages: 40, pagesLeft: 12, retryAt: new Date("2026-11-16T03:00:00.000Z") };
const AWAITING = JSON.stringify({ kind: "awaiting-reader", deferredLeg: "comprehensive" });

describe("shownOcrPagesHold", () => {
	it("shows the hold while the crawl is pending", () => {
		assert.equal(shownOcrPagesHold({ hold: HOLD, crawl: { status: "pending", startedAt: "2026-11-15T00:00:00.000Z" } }), HOLD);
	});

	it("shows the hold while the crawl awaits a reader", () => {
		assert.equal(shownOcrPagesHold({ hold: HOLD, crawl: { status: "unsupported", reason: AWAITING } }), HOLD);
	});

	it.each([
		["ready", { status: "ready" as const }],
		["failed", { status: "failed" as const, reason: "crawl-failed", outcomeRevision: 1 }],
		["unsupported for another reason", { status: "unsupported" as const, reason: JSON.stringify({ kind: "paywall" }) }],
		["unsupported with a plain-text reason", { status: "unsupported" as const, reason: "non-html content type" }],
	])("hides a stale hold once the crawl is %s", (_name, crawl) => {
		assert.equal(shownOcrPagesHold({ hold: HOLD, crawl }), undefined);
	});

	it("hides the hold when the crawl state is unknown", () => {
		assert.equal(shownOcrPagesHold({ hold: HOLD, crawl: undefined }), undefined);
	});

	it("shows nothing for a save with no hold", () => {
		assert.equal(shownOcrPagesHold({ hold: undefined, crawl: { status: "pending", startedAt: "2026-11-15T00:00:00.000Z" } }), undefined);
	});
});
