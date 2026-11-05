import { JSDOM } from "jsdom";
import { pageReaderSections, requestedReaderSection, sectionHref, type SectionPage } from "./section-pages";

const PRELUDE = '<p data-test-prelude>Contents: <a href="#section-ch-3">Chapter 3</a></p>';
const BOOK = [
	PRELUDE,
	'<h2 id="section-ch-1">One</h2><p>First <a href="#section-ch-1">here</a>.</p>',
	'<h2 id="section-ch-2">Two</h2><h2 id="section-a-chapter-s-own-title">Own title</h2><p>Second.</p>',
	'<h2 id="section-ch-3">Three</h2><p>Third.</p>',
].join("");

const READER_PATH = "/queue/abc/view?platform=ios-app&queue=books";

function paged(input: { requested: number | undefined; split?: "every-heading" | "chapter-headings" }) {
	const page = pageReaderSections({
		html: BOOK,
		section: { requested: input.requested, readerPath: READER_PATH },
		split: input.split ?? "chapter-headings",
		thresholdBytes: 10,
	});
	if (page.kind !== "paged") throw new Error(`expected a paged body, got ${page.kind}`);
	return page;
}

function h2Ids(html: string): string[] {
	const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
	return Array.from(doc.querySelectorAll("h2"), (heading) => heading.id);
}

function linkTo(input: { html: string; text: string }): HTMLAnchorElement {
	const doc = new JSDOM(`<!doctype html><body>${input.html}</body>`).window.document;
	const link = Array.from(doc.querySelectorAll("a")).find((anchor) => anchor.textContent === input.text);
	if (!link) throw new Error(`no link "${input.text}"`);
	return link;
}

describe("pageReaderSections", () => {
	it("returns a body at or under the threshold whole and unchanged", () => {
		const page: SectionPage = pageReaderSections({
			html: BOOK,
			section: { requested: 2, readerPath: READER_PATH },
			split: "chapter-headings",
			thresholdBytes: Buffer.byteLength(BOOK),
		});

		expect(page).toEqual({ kind: "whole", html: BOOK });
	});

	it("returns a body over the threshold with no page heading whole", () => {
		const html = "<p>One long paragraph.</p>";

		expect(
			pageReaderSections({
				html,
				section: { requested: undefined, readerPath: READER_PATH },
				split: "every-heading",
				thresholdBytes: 1,
			}),
		).toEqual({ kind: "whole", html });
	});

	it("puts the prelude and the first chapter on page 1, and keeps every heading in wholeHtml", () => {
		const page = paged({ requested: undefined });

		expect({ ids: h2Ids(page.html), wholeIds: h2Ids(page.wholeHtml), prelude: page.html.includes("data-test-prelude") }).toEqual({
			ids: ["section-ch-1"],
			wholeIds: ["section-ch-1", "section-ch-2", "section-a-chapter-s-own-title", "section-ch-3"],
			prelude: true,
		});
	});

	it("keeps a chapter's own h2 on its chapter's page when splitting at chapter headings", () => {
		const page = paged({ requested: 2 });

		expect({ ids: h2Ids(page.html), total: page.pager.total }).toEqual({
			ids: ["section-ch-2", "section-a-chapter-s-own-title"],
			total: 3,
		});
	});

	it("starts a page at every top-level h2 when splitting at every heading", () => {
		const page = paged({ requested: 3, split: "every-heading" });

		expect({ ids: h2Ids(page.html), total: page.pager.total }).toEqual({
			ids: ["section-a-chapter-s-own-title"],
			total: 4,
		});
	});

	it.each([0, -1, "x", 4])("falls back to page 1 when the request %p does not parse to a page", (raw) => {
		const page = paged({ requested: requestedReaderSection(raw) });

		expect(h2Ids(page.html)).toEqual(["section-ch-1"]);
	});

	it("maps each anchor to its page", () => {
		expect(Object.fromEntries(paged({ requested: 1 }).pageOfAnchor)).toEqual({
			"section-ch-1": 1,
			"section-ch-2": 2,
			"section-a-chapter-s-own-title": 2,
			"section-ch-3": 3,
		});
	});

	it("rewrites an in-body link to another page into a boosted section href, and leaves a same-page link alone", () => {
		const page = paged({ requested: 1 });
		const crossPage = linkTo({ html: page.html, text: "Chapter 3" });
		const samePage = linkTo({ html: page.html, text: "here" });

		expect({
			href: crossPage.getAttribute("href"),
			boost: crossPage.getAttribute("hx-boost"),
			target: crossPage.getAttribute("hx-target"),
			select: crossPage.getAttribute("hx-select"),
			swap: crossPage.getAttribute("hx-swap"),
			samePageHref: samePage.getAttribute("href"),
		}).toEqual({
			href: sectionHref({ readerPath: READER_PATH, section: 3, anchorId: "section-ch-3" }),
			boost: "true",
			target: "main",
			select: "main",
			swap: "outerHTML show:none",
			samePageHref: "#section-ch-1",
		});
	});

	it("gives page 1 a next link only and the last page a previous link only", () => {
		const first = paged({ requested: 1 }).pager;
		const last = paged({ requested: 3 }).pager;

		expect({ first, last }).toEqual({
			first: {
				current: 1,
				total: 3,
				previousHref: undefined,
				nextHref: sectionHref({ readerPath: READER_PATH, section: 2, anchorId: undefined }),
			},
			last: {
				current: 3,
				total: 3,
				previousHref: sectionHref({ readerPath: READER_PATH, section: 2, anchorId: undefined }),
				nextHref: undefined,
			},
		});
	});
});

describe("sectionHref", () => {
	it("keeps the reader path's own query, adds the section and the anchor, and carries internal tracking", () => {
		const href = sectionHref({ readerPath: READER_PATH, section: 3, anchorId: "section-ch-3" });
		const url = new URL(href, "https://readplace.com");

		expect({
			path: url.pathname,
			questionMarks: href.split("?").length - 1,
			platform: url.searchParams.get("platform"),
			queue: url.searchParams.get("queue"),
			section: url.searchParams.get("section"),
			utmSource: url.searchParams.get("utm_source"),
			hash: url.hash,
		}).toEqual({
			path: "/queue/abc/view",
			questionMarks: 1,
			platform: "ios-app",
			queue: "books",
			section: "3",
			utmSource: "reader",
			hash: "#section-ch-3",
		});
	});

	it("adds the section to a path with no query", () => {
		expect(new URL(sectionHref({ readerPath: "/view/example.com/a", section: 2, anchorId: undefined }), "https://readplace.com").search).toContain(
			"?section=2&",
		);
	});
});
