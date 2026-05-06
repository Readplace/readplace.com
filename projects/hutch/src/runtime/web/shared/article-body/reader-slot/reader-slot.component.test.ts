import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderReaderSlot } from "./reader-slot.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

const URL = "https://example.com/article";

describe("renderReaderSlot", () => {
	it("returns only the slot HTML (no outer page)", () => {
		const html = renderReaderSlot({
			crawl: { status: "ready" },
			content: "<p>Body</p>",
			url: URL,
		});

		expect(html.startsWith("<div")).toBe(true);
		expect(html.includes("<html")).toBe(false);
	});

	it("routes status=pending to the pending component with the poll URL", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "pending" },
				url: URL,
				readerPollUrl: "/queue/abc/reader?poll=1",
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/reader?poll=1");
		expect(slot.getAttribute("hx-trigger")).toBe("every 3s");
	});

	it("routes status=failed to the failed component", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "failed", reason: "exceeded SQS maxReceiveCount" },
				url: URL,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("failed");
		expect(slot.querySelector("a")?.getAttribute("href")).toBe(URL);
	});

	it("routes status=ready with content to the ready component", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "ready" },
				content: "<p>Body copy</p>",
				url: URL,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("ready");
		expect(slot.innerHTML.trim()).toBe("<p>Body copy</p>");
	});

	it("renders pending when crawl status is missing and no content is available (read-after-write race)", () => {
		const doc = parse(
			renderReaderSlot({
				url: URL,
				readerPollUrl: "/queue/abc/reader?poll=1",
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/reader?poll=1");
	});

	it("treats a legacy row (no crawl status) with content as ready", () => {
		const doc = parse(
			renderReaderSlot({
				content: "<p>Legacy body</p>",
				url: URL,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("ready");
	});

	it("renders pending when crawl is ready but content is missing (worker-bug catch-all → stays pending until a system flips the state)", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "ready" },
				url: URL,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
	});
});
