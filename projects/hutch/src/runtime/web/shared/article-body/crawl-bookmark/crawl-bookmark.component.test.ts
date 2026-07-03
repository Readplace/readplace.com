import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { toAbsoluteShortDateTime } from "@packages/web-shell/local-time.format";
import { renderCrawlBookmark } from "./crawl-bookmark.component";

function parse(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

describe("renderCrawlBookmark", () => {
	it("renders a single selected canonical tab carrying the crawl instant", () => {
		const lastCrawledAt = toAbsoluteShortDateTime({ iso: "2026-03-26T14:32:00.000Z" });

		const doc = parse(renderCrawlBookmark({ lastCrawledAt }));

		const tab = doc.querySelector('[data-test-crawl-bookmark-tab="canonical"]');
		assert(tab, "the canonical tab must render");
		expect(tab.classList.contains("crawl-bookmark__tab--selected")).toBe(true);
		expect(tab.textContent).toContain("Last crawled at");

		const time = tab.querySelector("time");
		assert(time, "the tab must carry a <time> for the crawl instant");
		expect(time.getAttribute("datetime")).toBe("2026-03-26T14:32:00.000Z");
		expect(time.getAttribute("data-local-time")).toBe("short-datetime");
		expect(time.textContent).toBe("26 Mar '26, 14:32");
	});

	it("renders exactly one tab inside an open <details> bookmark", () => {
		const doc = parse(
			renderCrawlBookmark({
				lastCrawledAt: toAbsoluteShortDateTime({ iso: "2026-03-26T14:32:00.000Z" }),
			}),
		);

		const bookmark = doc.querySelector("details.crawl-bookmark");
		assert(bookmark, "the bookmark must be a <details>");
		expect(bookmark.hasAttribute("open")).toBe(true);
		expect(doc.querySelectorAll(".crawl-bookmark__tab").length).toBe(1);
	});

	it("renders nothing before the first crawl records a contentFetchedAt", () => {
		expect(renderCrawlBookmark({ lastCrawledAt: undefined })).toBe("");
	});
});
