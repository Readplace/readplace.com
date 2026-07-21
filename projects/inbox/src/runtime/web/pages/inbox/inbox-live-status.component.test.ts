import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	buildCardResolvedAnnouncement,
	renderInboxLiveStatus,
} from "./inbox-live-status.component";

function region(html: string): Element {
	const el = new JSDOM(html).window.document.querySelector("[data-test-inbox-live-status]");
	assert(el, "the live region must render");
	return el;
}

describe("renderInboxLiveStatus", () => {
	it("renders a polite status region the page can keep for the whole visit", () => {
		const el = region(renderInboxLiveStatus({ message: "", oob: false }));

		expect(el.getAttribute("role")).toBe("status");
		expect(el.getAttribute("aria-live")).toBe("polite");
		expect(el.textContent).toBe("");
	});

	it("updates only the text on an out-of-band swap, so the announcing element survives", () => {
		const el = region(renderInboxLiveStatus({ message: "Preview ready: A post", oob: true }));

		// outerHTML would replace the element the screen reader is watching, and the
		// replacement is not reliably announced.
		expect(el.getAttribute("hx-swap-oob")).toBe("innerHTML");
		expect(el.textContent).toBe("Preview ready: A post");
	});

	it("keeps the same id inline and out of band, which is what htmx matches on", () => {
		const inline = region(renderInboxLiveStatus({ message: "", oob: false }));
		const swapped = region(renderInboxLiveStatus({ message: "Anything", oob: true }));

		expect(inline.getAttribute("id")).toBe("inbox-email-detail-live-status");
		expect(swapped.getAttribute("id")).toBe(inline.getAttribute("id"));
	});
});

describe("buildCardResolvedAnnouncement", () => {
	it("names the article once a crawl produced a title", () => {
		expect(
			buildCardResolvedAnnouncement({
				status: "crawled",
				title: "The Cost of Abstraction",
				url: "https://example.com/post",
			}),
		).toBe("Preview ready: The Cost of Abstraction");
	});

	it("falls back to the url when the crawled page had no title to read out", () => {
		expect(
			buildCardResolvedAnnouncement({
				status: "crawled",
				title: "",
				url: "https://example.com/post",
			}),
		).toBe("Preview ready for https://example.com/post");
	});

	it("says a failed crawl is finished rather than leaving it sounding pending", () => {
		expect(
			buildCardResolvedAnnouncement({
				status: "failed",
				title: "",
				url: "https://example.com/post",
			}),
		).toBe("No preview available for https://example.com/post");
	});

	it("stays silent while the link is still pending, so a 3s tick announces nothing", () => {
		expect(
			buildCardResolvedAnnouncement({
				status: "pending",
				title: "",
				url: "https://example.com/post",
			}),
		).toBe("");
	});
});
