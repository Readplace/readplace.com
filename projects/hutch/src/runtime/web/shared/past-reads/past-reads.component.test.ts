import assert from "node:assert/strict";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import type { PastReads } from "@packages/provider-contracts/related-articles";
import { JSDOM } from "jsdom";
import { siteLabel } from "../../test-helpers/article-fixtures";
import { renderPastReadsSection } from "./past-reads.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

const SOURCE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const IN_WORK = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const IN_DEFAULT = ReaderArticleHashIdSchema.parse("fedcba9876543210fedcba9876543210");
const WORK = ReadlistSlugSchema.parse("work");
const NOW = new Date("2026-09-15T12:00:00.000Z");
const READ_THREE_DAYS_AGO = new Date("2026-09-12T12:00:00.000Z");

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
			now: NOW,
			readerPathForReadlist,
		});
		const doc = parse(html);
		const slot = doc.querySelector("[data-test-reader-topic-reads]");
		assert(slot, "the slot always renders");

		expect(slot.getAttribute("data-topic-reads-status")).toBe("pending");
		expect(slot.className).toContain("past-reads--hidden");
		expect(slot.getAttribute("hx-get")).toBe("/queue/x/topic-reads?poll=2");
		expect(slot.querySelectorAll("[data-test-topic-read-item]")).toHaveLength(0);
		// htmx auto-fire form (hidden) plus a no-JS fallback inside <noscript>.
		const requestForm = slot.querySelector("form.past-reads__request");
		assert(requestForm, "the htmx compute request form is present");
		expect(requestForm.getAttribute("hx-trigger")).toBe("load");
		expect(requestForm.getAttribute("hx-swap")).toBe("none ignoreTitle:true");
		const noscript = doc.querySelector("noscript");
		assert(noscript, "the no-JS fallback is rendered");
		expect(slot.contains(noscript)).toBe(false);
	});

	it("renders up to three compact rows, opening each in its owned reading list", () => {
		const pastReads: PastReads = {
			status: "ready",
			items: [
				{ id: IN_WORK, title: "In a custom list", siteName: siteLabel("Example"), reason: "Same subject", readAt: READ_THREE_DAYS_AGO, readlist: WORK },
				{ id: IN_DEFAULT, title: "In the default list", siteName: siteLabel("Example"), reason: "Also the subject" },
			],
		};
		const html = renderPastReadsSection({
			pastReads,
			pollUrl: "/queue/x/topic-reads?poll=2",
			computeUrl: "/queue/x/topic-reads",
			sourceArticleId: SOURCE_ID,
			now: NOW,
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

	it("labels each row with when it was last read, as a relative time anchored on now", () => {
		const html = renderPastReadsSection({
			pastReads: {
				status: "ready",
				items: [
					{ id: IN_WORK, title: "In a custom list", siteName: siteLabel("Example"), reason: "Same subject", readAt: READ_THREE_DAYS_AGO, readlist: WORK },
					{ id: IN_DEFAULT, title: "In the default list", siteName: siteLabel("Example"), reason: "Also the subject" },
				],
			},
			computeUrl: "/queue/x/topic-reads",
			sourceArticleId: SOURCE_ID,
			now: NOW,
			readerPathForReadlist,
		});
		const doc = parse(html);

		const workRow = doc.querySelector(`[data-test-topic-read-item="${IN_WORK.value}"]`);
		assert(workRow, "the row with a read timestamp renders");
		const readTime = workRow.querySelector("[data-test-topic-read-time]");
		assert(readTime, "a row with a read timestamp shows when it was last read");
		expect(readTime.textContent).toBe("You read this 3 days ago");
		const time = readTime.querySelector("time");
		assert(time, "the relative label is wrapped in a <time> the client can localise");
		expect(time.getAttribute("datetime")).toBe(READ_THREE_DAYS_AGO.toISOString());
		expect(time.getAttribute("data-local-time")).toBe("relative");

		// A match whose read row carries no timestamp shows no invented "last read".
		const defaultRow = doc.querySelector(`[data-test-topic-read-item="${IN_DEFAULT.value}"]`);
		assert(defaultRow, "the row without a read timestamp still renders");
		expect(defaultRow.querySelector("[data-test-topic-read-time]")).toBeNull();
	});

	it("collapses the ready rows under a closed disclosure headed by the section title", () => {
		const html = renderPastReadsSection({
			pastReads: {
				status: "ready",
				items: [
					{ id: IN_WORK, title: "In a custom list", siteName: siteLabel("Example"), reason: "Same subject", readlist: WORK },
					{ id: IN_DEFAULT, title: "In the default list", siteName: siteLabel("Example"), reason: "Also the subject" },
				],
			},
			computeUrl: "/queue/x/topic-reads",
			sourceArticleId: SOURCE_ID,
			now: NOW,
			readerPathForReadlist,
		});
		const card = parse(html).querySelector("details.past-reads__card");
		assert(card, "a ready result renders a collapsible card");
		expect(card.hasAttribute("open")).toBe(false);
		expect(card.querySelector(".past-reads__eyebrow")?.textContent).toBe(
			"You've already seen this before",
		);
		const rows = Array.from(card.querySelectorAll("[data-test-topic-read-item]"));
		expect(rows.map((row) => row.getAttribute("data-test-topic-read-item"))).toEqual([
			IN_WORK.value,
			IN_DEFAULT.value,
		]);
	});

	it("previews the first past read's title and site with a see-more cue inside the toggle", () => {
		const html = renderPastReadsSection({
			pastReads: {
				status: "ready",
				items: [
					{ id: IN_WORK, title: "In a custom list", siteName: siteLabel("Example"), reason: "Same subject", readlist: WORK },
					{ id: IN_DEFAULT, title: "In the default list", siteName: siteLabel("Elsewhere"), reason: "Also the subject" },
				],
			},
			computeUrl: "/queue/x/topic-reads",
			sourceArticleId: SOURCE_ID,
			now: NOW,
			readerPathForReadlist,
		});
		const preview = parse(html).querySelector(".past-reads__preview");
		assert(preview, "the toggle previews the first past read");
		expect(preview.closest("summary.past-reads__toggle")).not.toBeNull();
		expect(preview.querySelector(".past-reads__preview-title")?.textContent).toBe("In a custom list");
		expect(preview.querySelector(".past-reads__preview-site")?.textContent).toBe("Example");
		expect(preview.querySelector(".past-reads__more")?.textContent).toBe("See more…");
	});

	it("hides the preview from assistive technology so the toggle is named by its heading", () => {
		const html = renderPastReadsSection({
			pastReads: {
				status: "ready",
				items: [{ id: IN_WORK, title: "In a custom list", siteName: siteLabel("Example"), reason: "Same subject", readlist: WORK }],
			},
			computeUrl: "/queue/x/topic-reads",
			sourceArticleId: SOURCE_ID,
			now: NOW,
			readerPathForReadlist,
		});
		expect(parse(html).querySelector(".past-reads__preview")?.getAttribute("aria-hidden")).toBe("true");
	});

	it("keeps links and controls out of the toggle so opening it never navigates", () => {
		const html = renderPastReadsSection({
			pastReads: {
				status: "ready",
				items: [{ id: IN_WORK, title: "In a custom list", siteName: siteLabel("Example"), reason: "Same subject", readlist: WORK }],
			},
			computeUrl: "/queue/x/topic-reads",
			sourceArticleId: SOURCE_ID,
			now: NOW,
			readerPathForReadlist,
		});
		const summary = parse(html).querySelector("summary.past-reads__toggle");
		assert(summary, "the card has a toggle");
		expect(summary.querySelectorAll("a, button, input, select, textarea, [tabindex]")).toHaveLength(0);
		expect(summary.querySelector(".past-reads__caret svg")).not.toBeNull();
	});

	it("previews the only past read when a single one qualifies", () => {
		const html = renderPastReadsSection({
			pastReads: {
				status: "ready",
				items: [{ id: IN_DEFAULT, title: "The lone match", siteName: siteLabel("Solo"), reason: "Same subject" }],
			},
			computeUrl: "/queue/x/topic-reads",
			sourceArticleId: SOURCE_ID,
			now: NOW,
			readerPathForReadlist,
		});
		const doc = parse(html);
		expect(doc.querySelector(".past-reads__preview-title")?.textContent).toBe("The lone match");
		expect(doc.querySelector(".past-reads__preview-site")?.textContent).toBe("Solo");
		expect(doc.querySelectorAll("[data-test-topic-read-item]")).toHaveLength(1);
	});

	it("stays hidden but keeps the section (and its refresh) for a cached empty result", () => {
		const html = renderPastReadsSection({
			pastReads: { status: "ready", items: [] },
			computeUrl: "/queue/x/topic-reads",
			sourceArticleId: SOURCE_ID,
			now: NOW,
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
			now: NOW,
			readerPathForReadlist,
		});
		expect(
			parse(html)
				.querySelector("[data-test-reader-topic-reads]")
				?.getAttribute("data-topic-reads-status"),
		).toBe("pending");
	});

	it("tags the no-JS fallback as a reader click, leaving the auto-firing request untagged", () => {
		const html = renderPastReadsSection({
			pastReads: { status: "pending" },
			computeUrl: "/queue/x/topic-reads?platform=ios",
			sourceArticleId: SOURCE_ID,
			now: NOW,
			readerPathForReadlist,
		});
		const doc = parse(html);
		const noscript = doc.querySelector("noscript");
		assert(noscript, "the no-JS fallback is rendered");
		const fallback = parse(noscript.innerHTML).querySelector("form.past-reads__fallback");
		assert(fallback, "the no-JS fallback is a form");
		const request = doc.querySelector("form.past-reads__request");
		assert(request, "the htmx compute request form is present");

		expect({
			fallback: fallback.getAttribute("action"),
			request: request.getAttribute("action"),
		}).toEqual({
			fallback: `/queue/x/topic-reads?platform=ios&utm_source=reader&utm_medium=internal&utm_content=find-past-reads&utm_term=${SOURCE_ID}`,
			request: "/queue/x/topic-reads?platform=ios",
		});
	});

	it("renders no compute triggers when the caller supplies no compute url", () => {
		const html = renderPastReadsSection({
			pastReads: { status: "pending" },
			sourceArticleId: SOURCE_ID,
			now: NOW,
			readerPathForReadlist,
		});
		const slot = parse(html).querySelector("[data-test-reader-topic-reads]");
		assert(slot, "the slot renders");
		expect(slot.querySelector("form.past-reads__request")).toBeNull();
		expect(html).not.toContain("<noscript>");
	});
});
