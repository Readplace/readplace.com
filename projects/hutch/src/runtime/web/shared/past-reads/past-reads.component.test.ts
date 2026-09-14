import assert from "node:assert/strict";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import type { PastReads } from "@packages/provider-contracts/related-articles";
import { JSDOM } from "jsdom";
import { renderPastReadsSection } from "./past-reads.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

const SOURCE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const IN_WORK = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const IN_DEFAULT = ReaderArticleHashIdSchema.parse("fedcba9876543210fedcba9876543210");
const WORK = ReadlistSlugSchema.parse("work");

const readerPathForReadlist = (articleId: string, readlist?: string) =>
	readlist === undefined
		? `/queue/${articleId}/view`
		: `/queue/${articleId}/view?queue=${readlist}`;

describe("renderPastReadsSection", () => {
	it("hides the section and polls while the selection is pending, offering the JS and no-JS compute triggers", () => {
		const html = renderPastReadsSection({
			pastReads: { status: "pending" },
			pollUrl: "/queue/x/topic-reads?poll=2",
			computeUrl: "/queue/x/topic-reads",
			sourceArticleId: SOURCE_ID,
			readerPathForReadlist,
		});
		const slot = parse(html).querySelector("[data-test-reader-topic-reads]");
		assert(slot, "the slot always renders");

		expect(slot.getAttribute("data-topic-reads-status")).toBe("pending");
		expect(slot.className).toContain("past-reads--hidden");
		expect(slot.getAttribute("hx-get")).toBe("/queue/x/topic-reads?poll=2");
		expect(slot.querySelectorAll("[data-test-topic-read-item]")).toHaveLength(0);
		// htmx auto-fire form (hidden) plus a no-JS fallback inside <noscript>.
		const requestForm = slot.querySelector("form.past-reads__request");
		assert(requestForm, "the htmx compute request form is present");
		expect(requestForm.getAttribute("hx-trigger")).toBe("load");
		expect(html).toContain("<noscript>");
	});

	it("renders up to three compact rows, opening each in its owned reading list", () => {
		const pastReads: PastReads = {
			status: "ready",
			items: [
				{ id: IN_WORK, title: "In a custom list", siteName: "Example", reason: "Same subject", readlist: WORK },
				{ id: IN_DEFAULT, title: "In the default list", siteName: "Example", reason: "Also the subject" },
			],
		};
		const html = renderPastReadsSection({
			pastReads,
			pollUrl: "/queue/x/topic-reads?poll=2",
			computeUrl: "/queue/x/topic-reads",
			sourceArticleId: SOURCE_ID,
			readerPathForReadlist,
		});
		const doc = parse(html);
		const slot = doc.querySelector("[data-test-reader-topic-reads]");
		assert(slot, "the slot renders");

		expect(slot.getAttribute("data-topic-reads-status")).toBe("ready");
		expect(slot.className).toContain("past-reads--ready");
		// A ready result never polls.
		expect(slot.getAttribute("hx-get")).toBe(null);
		// No no-JS fallback once there are results to show.
		expect(html).not.toContain("<noscript>");

		const rows = Array.from(doc.querySelectorAll("[data-test-topic-read-item]"));
		expect(rows.map((row) => row.getAttribute("data-test-topic-read-item"))).toEqual([
			IN_WORK.value,
			IN_DEFAULT.value,
		]);

		const workRow = doc.querySelector(`[data-test-topic-read-item="${IN_WORK.value}"]`);
		assert(workRow, "the custom-list row renders");
		expect(workRow.querySelector(".past-reads__title")?.textContent).toBe("In a custom list");
		expect(workRow.querySelector(".past-reads__reason")?.textContent).toBe("Same subject");
		expect(workRow.getAttribute("aria-label")).toBe("In a custom list — Example");
		const workHref = workRow.getAttribute("href") ?? "";
		expect(workHref).toContain(`/queue/${IN_WORK.value}/view`);
		expect(workHref).toContain("queue=work");
		expect(workHref).toContain("utm_content=topic-read");

		const defaultHref =
			doc.querySelector(`[data-test-topic-read-item="${IN_DEFAULT.value}"]`)?.getAttribute("href") ??
			"";
		expect(defaultHref).not.toContain("queue=");
	});

	it("stays hidden but keeps the section (and its refresh) for a cached empty result", () => {
		const html = renderPastReadsSection({
			pastReads: { status: "ready", items: [] },
			computeUrl: "/queue/x/topic-reads",
			sourceArticleId: SOURCE_ID,
			readerPathForReadlist,
		});
		const slot = parse(html).querySelector("[data-test-reader-topic-reads]");
		assert(slot, "the slot renders");

		expect(slot.className).toContain("past-reads--hidden");
		expect(slot.querySelectorAll("[data-test-topic-read-item]")).toHaveLength(0);
		expect(slot.querySelector("form.past-reads__request")).not.toBeNull();
		expect(html).toContain("<noscript>");
	});

	it("treats a missing selection as pending", () => {
		const html = renderPastReadsSection({
			sourceArticleId: SOURCE_ID,
			readerPathForReadlist,
		});
		expect(
			parse(html)
				.querySelector("[data-test-reader-topic-reads]")
				?.getAttribute("data-topic-reads-status"),
		).toBe("pending");
	});

	it("renders no compute triggers when the caller supplies no compute url", () => {
		const html = renderPastReadsSection({
			pastReads: { status: "pending" },
			sourceArticleId: SOURCE_ID,
			readerPathForReadlist,
		});
		const slot = parse(html).querySelector("[data-test-reader-topic-reads]");
		assert(slot, "the slot renders");
		expect(slot.querySelector("form.past-reads__request")).toBeNull();
		expect(html).not.toContain("<noscript>");
	});
});
