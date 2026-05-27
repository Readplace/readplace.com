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

	it("routes status=pending with a poll URL to the pending component", () => {
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

	it("renders the PDF accuracy-over-slop loading hint when the pending URL is a .pdf", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "pending" },
				url: "https://www.cia.gov/readingroom/docs/COMPUTERS%20AND%20AUTOMATION%20[16505689].pdf",
				readerPollUrl: "/queue/abc/reader?poll=1",
			}),
		);

		const subtitle = doc.querySelector(".article-body__reader-loading-subtitle");
		assert(subtitle, "loading-hint subtitle must render for a pending .pdf URL");
		expect(subtitle.textContent).toMatch(/accuracy over slop/);
	});

	it("omits the loading hint when the pending URL is an HTML article", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "pending" },
				url: "https://example.com/articles/some-post",
				readerPollUrl: "/queue/abc/reader?poll=1",
			}),
		);

		expect(doc.querySelector(".article-body__reader-loading-subtitle")).toBeNull();
	});

	it("omits the loading hint when the URL is invalid (URL parse throws)", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "pending" },
				url: "not-a-valid-url",
				readerPollUrl: "/queue/abc/reader?poll=1",
			}),
		);

		expect(doc.querySelector(".article-body__reader-loading-subtitle")).toBeNull();
	});

	it("routes status=pending WITHOUT a poll URL to the 'slow' reframe (poll cap exhausted)", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "pending" },
				url: URL,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("slow");
		expect(slot.getAttribute("hx-get")).toBeNull();
		assert.equal(
			doc.querySelector(".article-body__reader-notice-title")?.textContent,
			"Your link is saved",
		);
	});

	it("routes status=failed to the failed variant", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "failed", reason: "exceeded SQS maxReceiveCount" },
				url: URL,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("failed");
		expect(slot.getAttribute("hx-get")).toBeNull();
		assert.equal(
			doc.querySelector(".article-body__reader-notice-title")?.textContent,
			"Your link is saved",
		);
		expect(
			doc
				.querySelector("[data-test-reader-failed-primary]")
				?.getAttribute("href"),
		).toBe(URL);
	});

	it("routes status=unsupported to the unsupported variant with the reassuring title", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: {
					status: "unsupported",
					reason: "non-html content type: application/pdf",
				},
				url: URL,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("unsupported");
		expect(slot.getAttribute("hx-get")).toBeNull();
		assert.equal(
			doc.querySelector(".article-body__reader-notice-title")?.textContent,
			"Your link is saved",
		);
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
		const iframe = slot.querySelector("iframe[data-reader-iframe]");
		assert(iframe, "ready slot must wrap the body in a sandboxed iframe");
		const srcdoc = iframe.getAttribute("srcdoc");
		assert(srcdoc, "iframe must carry a srcdoc");
		const iframeDoc = new JSDOM(srcdoc).window.document;
		assert(iframeDoc.body, "iframe body must exist");
		expect(iframeDoc.body.innerHTML.trim()).toBe("<p>Body copy</p>");
	});

	it("renders pending when crawl status is missing, no content, and a poll URL exists (read-after-write race)", () => {
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

	it("renders the 'slow' reframe when crawl status is missing and there is no poll URL left", () => {
		const doc = parse(renderReaderSlot({ url: URL }));

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("slow");
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

	it("renders pending when crawl is ready but content is missing and a poll URL exists (worker-bug catch-all)", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "ready" },
				url: URL,
				readerPollUrl: "/queue/abc/reader?poll=1",
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
	});

	it("renders the 'slow' reframe when crawl is ready but content is missing and the poll cap has exhausted", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "ready" },
				url: URL,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("slow");
	});

	it("dispatches every CrawlStatus variant — adding a new variant must break this test (and the renderer's exhaustive switch)", () => {
		const variants: Array<{
			input: Parameters<typeof renderReaderSlot>[0];
			expected: string;
		}> = [
			{ input: { crawl: { status: "ready" }, content: "<p>x</p>", url: URL }, expected: "ready" },
			{ input: { crawl: { status: "pending" }, url: URL, readerPollUrl: "/p" }, expected: "pending" },
			{ input: { crawl: { status: "failed", reason: "x" }, url: URL }, expected: "failed" },
			{ input: { crawl: { status: "unsupported", reason: "x" }, url: URL }, expected: "unsupported" },
		];

		for (const { input, expected } of variants) {
			const doc = parse(renderReaderSlot(input));
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, `slot must render for status=${expected}`);
			expect(slot.getAttribute("data-reader-status")).toBe(expected);
		}
	});
});
