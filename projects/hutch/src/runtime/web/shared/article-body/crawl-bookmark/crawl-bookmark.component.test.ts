import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { toAbsoluteShortDateTime } from "@packages/web-shell/local-time.format";
import { renderCrawlBookmark } from "./crawl-bookmark.component";

function parse(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

describe("renderCrawlBookmark", () => {
	it("badges the newest version 'best' when more than one crawl exists, older ones disabled, newest first", () => {
		const versions = [
			toAbsoluteShortDateTime({ iso: "2026-07-10T09:14Z" }),
			toAbsoluteShortDateTime({ iso: "2026-06-28T22:01Z" }),
			toAbsoluteShortDateTime({ iso: "2026-03-26T14:32Z" }),
		];

		const doc = parse(renderCrawlBookmark({ versions }));

		const keys = Array.from(doc.querySelectorAll("[data-test-crawl-bookmark-tab]")).map((el) =>
			el.getAttribute("data-test-crawl-bookmark-tab"),
		);
		expect(keys).toEqual(["canonical", "2026-06-28T22:01Z", "2026-03-26T14:32Z"]);

		// Exactly one badge across the whole list, and it sits on the newest tab.
		expect(doc.querySelectorAll(".crawl-bookmark__badge").length).toBe(1);

		const current = doc.querySelector('[data-test-crawl-bookmark-tab="canonical"]');
		assert(current, "the current tab must render");
		expect(current.classList.contains("crawl-bookmark__tab--current")).toBe(true);
		expect(current.getAttribute("aria-disabled")).toBe("false");
		const badge = current.querySelector(".crawl-bookmark__badge");
		assert(badge, "the current tab must carry the badge");
		expect(badge.textContent).toBe("best");
		const currentTime = current.querySelector("time");
		assert(currentTime, "the current tab must carry a <time>");
		expect(currentTime.getAttribute("datetime")).toBe("2026-07-10T09:14Z");
		expect(currentTime.getAttribute("data-local-time")).toBe("short-datetime");
		expect(currentTime.textContent).toBe("10 Jul '26, 09:14");

		const older = doc.querySelector('[data-test-crawl-bookmark-tab="2026-06-28T22:01Z"]');
		assert(older, "an older version tab must render");
		expect(older.classList.contains("crawl-bookmark__tab--disabled")).toBe(true);
		expect(older.getAttribute("aria-disabled")).toBe("true");
		expect(older.querySelector("time")?.textContent).toBe("28 Jun '26, 22:01");
	});

	it("renders a single version as the current tab with a badge and no disabled tabs", () => {
		const doc = parse(
			renderCrawlBookmark({ versions: [toAbsoluteShortDateTime({ iso: "2026-03-26T14:32Z" })] }),
		);

		const tabs = doc.querySelectorAll("[data-test-crawl-bookmark-tab]");
		expect(tabs.length).toBe(1);
		const tab = tabs[0];
		expect(tab.getAttribute("data-test-crawl-bookmark-tab")).toBe("canonical");
		expect(tab.classList.contains("crawl-bookmark__tab--current")).toBe(true);
		expect(tab.querySelector(".crawl-bookmark__badge")?.textContent).toBe("current");
		expect(tab.querySelector("time")?.textContent).toBe("26 Mar '26, 14:32");
		expect(doc.querySelectorAll(".crawl-bookmark__tab--disabled").length).toBe(0);
	});

	it("renders every version inside an open <details> bookmark capsule", () => {
		const doc = parse(
			renderCrawlBookmark({
				versions: [
					toAbsoluteShortDateTime({ iso: "2026-03-26T14:32Z" }),
					toAbsoluteShortDateTime({ iso: "2026-01-01T00:00Z" }),
				],
			}),
		);

		const bookmark = doc.querySelector("details.crawl-bookmark");
		assert(bookmark, "the bookmark must be a <details>");
		expect(bookmark.hasAttribute("open")).toBe(true);
		expect(doc.querySelectorAll(".crawl-bookmark__tab").length).toBe(2);
	});

	it("renders nothing before any crawl version exists", () => {
		expect(renderCrawlBookmark({ versions: [] })).toBe("");
	});
});
