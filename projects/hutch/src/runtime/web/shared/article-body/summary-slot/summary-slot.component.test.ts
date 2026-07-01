import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderSummarySlot } from "./summary-slot.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

describe("renderSummarySlot", () => {
	it("returns only the slot HTML (no outer page)", () => {
		const html = renderSummarySlot({
			summary: { status: "ready", summary: "Point." },
			summaryOpen: false,
		});

		expect(html.startsWith("<div")).toBe(true);
		expect(html.includes("<html")).toBe(false);
	});

	it("routes status=ready to the ready component", () => {
		const doc = parse(
			renderSummarySlot({
				summary: { status: "ready", summary: "Key points." },
				summaryOpen: true,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("ready");
		const details = doc.querySelector(".article-body__summary");
		assert(details, "summary details element must be rendered");
		expect(details.hasAttribute("open")).toBe(true);
	});

	it("routes status=pending to the pending component with the poll URL once the reader view is ready", () => {
		const doc = parse(
			renderSummarySlot({
				crawl: { status: "ready" },
				content: "<p>x</p>",
				summary: { status: "pending" },
				summaryPollUrl: "/queue/abc/summary?poll=1",
			}),
		);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/summary?poll=1");
		expect(
			doc.querySelector(".article-body__summary-loading")?.textContent,
		).toBe("Generating summary");
	});

	it("defers the summary (empty, still polling) while the crawl is pending and content is absent", () => {
		const doc = parse(
			renderSummarySlot({
				crawl: { status: "pending" },
				content: undefined,
				summary: { status: "pending" },
				summaryPollUrl: "/queue/abc/summary?poll=1",
			}),
		);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("pending");
		expect(slot.classList.contains("article-body__summary-slot--hidden")).toBe(
			true,
		);
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/summary?poll=1");
		expect(slot.getAttribute("hx-trigger")).toBe("every 3s");
		expect(slot.getAttribute("hx-swap")).toBe("outerHTML");
		expect(doc.querySelector(".article-body__summary-loading")).toBe(null);
	});

	it("defers the summary during the promotion race (crawl ready but content not yet copied)", () => {
		const doc = parse(
			renderSummarySlot({
				crawl: { status: "ready" },
				content: undefined,
				summary: { status: "pending" },
				summaryPollUrl: "/queue/abc/summary?poll=1",
			}),
		);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("pending");
		expect(slot.classList.contains("article-body__summary-slot--hidden")).toBe(
			true,
		);
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/summary?poll=1");
		expect(doc.querySelector(".article-body__summary-loading")).toBe(null);
	});

	it("defers the summary when content is present but the crawl is back to pending (admin recrawl)", () => {
		const doc = parse(
			renderSummarySlot({
				crawl: { status: "pending" },
				content: "<p>x</p>",
				summary: { status: "pending" },
				summaryPollUrl: "/queue/abc/summary?poll=1",
			}),
		);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("pending");
		expect(slot.classList.contains("article-body__summary-slot--hidden")).toBe(
			true,
		);
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/summary?poll=1");
		expect(slot.getAttribute("hx-trigger")).toBe("every 3s");
		expect(slot.getAttribute("hx-swap")).toBe("outerHTML");
		expect(slot.children.length).toBe(0);
	});

	it("shows the pending indicator for a legacy ready row (crawl undefined, content present)", () => {
		const doc = parse(
			renderSummarySlot({
				crawl: undefined,
				content: "<p>x</p>",
				summary: { status: "pending" },
				summaryPollUrl: "/queue/abc/summary?poll=1",
			}),
		);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.classList.contains("article-body__summary-slot--visible")).toBe(
			true,
		);
		expect(
			doc.querySelector(".article-body__summary-loading")?.textContent,
		).toBe("Generating summary");
	});

	it("defers without poll attributes when there is no summary poll URL (e.g. unsupported crawl)", () => {
		const doc = parse(
			renderSummarySlot({
				crawl: { status: "unsupported", reason: "binary content" },
				content: undefined,
				summary: { status: "pending" },
			}),
		);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("pending");
		expect(slot.classList.contains("article-body__summary-slot--hidden")).toBe(
			true,
		);
		expect(slot.hasAttribute("hx-get")).toBe(false);
		expect(doc.querySelector(".article-body__summary-loading")).toBe(null);
	});

	it("HTML-escapes the deferred poll URL, matching the Handlebars-rendered pending slot", () => {
		const html = renderSummarySlot({
			crawl: { status: "pending" },
			content: undefined,
			summary: { status: "pending" },
			summaryPollUrl: "/view/summary?url=x&poll=1",
		});

		// The query-joining '&' must be HTML-escaped in the attribute, exactly as
		// Handlebars escapes the interpolated poll URL. getAttribute
		// then decodes it back to the URL htmx polls.
		expect(html).toContain("&amp;poll");
		const slot = parse(html).querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("hx-get")).toBe("/view/summary?url=x&poll=1");
	});

	it("routes status=failed to the failed component and surfaces the reason", () => {
		const doc = parse(
			renderSummarySlot({
				summary: { status: "failed", reason: "deepseek timeout" },
			}),
		);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("failed");
		expect(
			doc.querySelector("[data-test-reader-summary-failure-reason]")
				?.textContent,
		).toBe("deepseek timeout");
	});

	it("routes status=skipped with reason to the skipped component", () => {
		const doc = parse(
			renderSummarySlot({
				summary: { status: "skipped", reason: "content-too-short" },
			}),
		);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("skipped");
		const info = doc.querySelector(".article-body__summary-info");
		assert(info, "info card must be rendered");
		expect(info.getAttribute("data-test-reader-summary-skip-reason")).toBe(
			"content-too-short",
		);
		expect(info.textContent).toBe("This article is too short to summarise.");
	});

	it("routes status=skipped without reason to the skipped component with fallback copy", () => {
		const doc = parse(renderSummarySlot({ summary: { status: "skipped" } }));

		const info = doc.querySelector(".article-body__summary-info");
		assert(info, "info card must be rendered");
		expect(info.textContent).toBe("No summary was generated for this article.");
	});

	it("hides the slot when the crawl has failed (reader-failed card carries the message)", () => {
		const doc = parse(
			renderSummarySlot({
				crawl: { status: "failed", reason: "blocked" },
				summary: { status: "pending" },
			}),
		);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("skipped");
		expect(slot.classList.contains("article-body__summary-slot--hidden")).toBe(
			true,
		);
		expect(slot.children.length).toBe(0);
	});

	it("defaults to the deferred variant when summary is undefined and the reader view is not ready", () => {
		const doc = parse(renderSummarySlot({ summary: undefined }));

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("pending");
		expect(slot.classList.contains("article-body__summary-slot--hidden")).toBe(
			true,
		);
		expect(doc.querySelector(".article-body__summary-loading")).toBe(null);
	});

	it("defaults to the pending indicator when summary is undefined but the reader view is ready", () => {
		const doc = parse(
			renderSummarySlot({
				crawl: { status: "ready" },
				content: "<p>x</p>",
				summary: undefined,
				summaryPollUrl: "/queue/abc/summary?poll=1",
			}),
		);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("pending");
		expect(
			doc.querySelector(".article-body__summary-loading")?.textContent,
		).toBe("Generating summary");
	});
});
