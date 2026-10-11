import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderSummarySlot } from "./summary-slot.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

function summaryProgressTrack(doc: Document): Element {
	const track = doc.querySelector('[data-test-progress-bar="summary"] [role="progressbar"]');
	assert(track, "the summary progress track must be rendered");
	return track;
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
		const details = doc.querySelector(".tldr-disclosure");
		assert(details, "summary details element must be rendered");
		expect(details.hasAttribute("open")).toBe(true);
	});

	it("forwards a ready summary's excerpt into the collapsed preview", () => {
		const doc = parse(
			renderSummarySlot({
				summary: { status: "ready", summary: "The full summary.", excerpt: "The teaser." },
				summaryOpen: false,
			}),
		);

		expect(doc.querySelector(".tldr-disclosure__preview")?.textContent).toBe("The teaser.");
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
			doc.querySelector("[data-test-summary-pending-title]")?.textContent,
		).toBe("Generating summary");
		expect(summaryProgressTrack(doc).getAttribute("aria-valuenow")).toBe("29");
	});

	it("reports the recorded summary stage on the summary's own axis", () => {
		const doc = parse(
			renderSummarySlot({
				crawl: { status: "ready" },
				content: "<p>x</p>",
				summary: { status: "pending", stage: "summary-generating" },
				summaryPollUrl: "/queue/abc/summary?poll=1",
			}),
		);

		expect(summaryProgressTrack(doc).getAttribute("aria-valuenow")).toBe("90");
	});

	it("renders the exhausted panel once the reader view is ready and the poll budget has run out", () => {
		const doc = parse(
			renderSummarySlot({
				crawl: { status: "ready" },
				content: "<p>x</p>",
				summary: { status: "pending" },
			}),
		);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("pending");
		expect(slot.classList.contains("article-body__summary-slot--visible")).toBe(true);
		expect(slot.hasAttribute("hx-get")).toBe(false);
		const description = slot.querySelector("[data-test-summary-pending-text]");
		assert(description, "the description must be rendered");
		expect(description.classList.contains("article-body__panel-text--visible")).toBe(true);
		const bar = slot.querySelector('[data-test-progress-bar="summary"]');
		assert(bar, "the summary progress block must be rendered");
		expect(bar.classList.contains("article-body__progress--hidden")).toBe(true);
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
			doc.querySelector("[data-test-summary-pending-title]")?.textContent,
		).toBe("Generating summary");
	});

	it("collapses when the crawl is unsupported", () => {
		const doc = parse(
			renderSummarySlot({
				crawl: { status: "unsupported", reason: "binary content" },
				content: undefined,
				summary: { status: "pending" },
			}),
		);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("skipped");
		expect(slot.classList.contains("article-body__summary-slot--hidden")).toBe(
			true,
		);
		expect(slot.hasAttribute("hx-get")).toBe(false);
		expect(slot.children.length).toBe(0);
	});

	it("collapses an unsupported crawl whose summary is a non-crawl skip", () => {
		const doc = parse(
			renderSummarySlot({
				crawl: { status: "unsupported", reason: "binary content" },
				summary: { status: "skipped", reason: "content-too-short" },
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

	it.each(["crawl-unsupported", "crawl-failed"])(
		"collapses a %s skip while the crawl is pending (admin recrawl)",
		(reason) => {
			const doc = parse(
				renderSummarySlot({
					crawl: { status: "pending" },
					content: "<p>x</p>",
					summary: { status: "skipped", reason },
				}),
			);

			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("skipped");
			expect(slot.classList.contains("article-body__summary-slot--hidden")).toBe(
				true,
			);
			expect(slot.hasAttribute("hx-get")).toBe(false);
			expect(slot.children.length).toBe(0);
		},
	);

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

	it("routes status=failed to the failed component, which shows fixed copy and never the pipeline reason", () => {
		const doc = parse(
			renderSummarySlot({
				summary: { status: "failed", reason: "deepseek timeout" },
			}),
		);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("failed");
		const alert = slot.querySelector('[data-test-alert="reader-summary-failed"]');
		assert(alert, "the failure alert must render");
		expect(alert.querySelector("[data-test-alert-title]")?.textContent).toBe(
			"Summary unavailable",
		);
		expect(alert.querySelector("[data-test-alert-message]")?.textContent).toBe(
			"Readplace couldn't generate a summary for this article.",
		);
		expect(slot.textContent).toBe(
			"Summary unavailableReadplace couldn't generate a summary for this article.",
		);
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
		expect(slot.getAttribute("data-test-reader-summary-skip-reason")).toBe(
			"content-too-short",
		);
		expect(
			slot.querySelector('[data-test-alert="reader-summary-skipped"] [data-test-alert-title]')
				?.textContent,
		).toBe("This article is too short to generate a summary.");
	});

	it("routes status=skipped without reason to the skipped component with fallback copy", () => {
		const doc = parse(renderSummarySlot({ summary: { status: "skipped" } }));

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-test-reader-summary-skip-reason")).toBe("");
		expect(
			slot.querySelector('[data-test-alert="reader-summary-skipped"] [data-test-alert-title]')
				?.textContent,
		).toBe("No summary was generated for this article.");
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
		expect(slot.hasAttribute("hx-get")).toBe(false);
		expect(slot.children.length).toBe(0);
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
			doc.querySelector("[data-test-summary-pending-title]")?.textContent,
		).toBe("Generating summary");
		expect(summaryProgressTrack(doc).getAttribute("aria-valuenow")).toBe("29");
	});
});
