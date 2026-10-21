import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { toAbsoluteDate, toAbsoluteTime } from "@packages/web-shell/local-time.format";
import { destinationUrl, siteLabel } from "../../test-helpers/article-fixtures";
import type { ArticleVersion } from "../article-reader/article-reader.types";
import { type ArticleRailInput, renderArticleBody, renderArticleRail } from "./article-body.component";
import { articleBody } from "@packages/test-fixtures";

const baseInput = {
	title: "Hello World",
	siteName: siteLabel("example.com"),
	readTime: { value: "3", label: "3 min read" },
	url: destinationUrl("https://example.com/post"),
	articleId: "0123456789abcdef0123456789abcdef",
	appOrigin: "https://readplace.com",
	topActionsHtml: "",
	bottomActionsHtml: "",
	saved: undefined,
};

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

function versionAt(iso: string): ArticleVersion {
	return { minuteId: iso, date: toAbsoluteDate({ iso }), time: toAbsoluteTime({ iso }) };
}

describe("renderArticleBody", () => {
	it("passes the owner's save provenance through to the header, and leaves it off when the caller has none", () => {
		const tagOf = (html: string) =>
			parse(html).querySelector("[data-test-reader-provenance]")?.textContent?.trim();

		expect([
			tagOf(renderArticleBody({ ...baseInput, provenance: { kind: "import" } })),
			tagOf(renderArticleBody(baseInput)),
		]).toEqual(["via Import", undefined]);
	});

	it("passes the owner's saved time through to the header", () => {
		const doc = parse(
			renderArticleBody({
				...baseInput,
				saved: { iso: "2026-04-25T06:00:00.000Z", label: "6h ago", mode: "relative" },
			}),
		);

		expect(doc.querySelector("[data-test-reader-saved]")?.textContent).toBe("6h ago");
	});

	it("renders the article title, site name, reading time and content", () => {
		const html = renderArticleBody({
			...baseInput,
			content: articleBody("<p>Body copy</p>"),
		});
		const doc = parse(html);

		expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe(
			"Hello World",
		);
		expect(doc.querySelector("[data-test-reader-site]")?.textContent).toBe(
			"example.com",
		);
		expect(doc.querySelector('[data-test-reader-fact="read-time"]')?.textContent).toBe(
			"3 min read",
		);
		const content = doc.querySelector("[data-test-reader-content]");
		assert(content, "reader content must be rendered");
		expect(content.innerHTML.trim()).toBe("<p>Body copy</p>");
	});

	it("delegates to the summary slot renderer", () => {
		const html = renderArticleBody({
			...baseInput,
			content: articleBody("<p>Body</p>"),
			summary: { status: "ready", summary: "Key points." },
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered inside the article body");
		expect(slot.getAttribute("data-summary-status")).toBe("ready");
	});

	it("defers the summary slot (no 'Generating summary') while the crawl is still pending", () => {
		const html = renderArticleBody({
			...baseInput,
			content: undefined,
			crawl: { status: "pending" },
			summary: { status: "pending" },
			summaryPollUrl: "/queue/abc/summary?poll=1",
			readerPollUrl: "/queue/abc/reader?poll=1",
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("pending");
		expect(slot.classList.contains("article-body__summary-slot--hidden")).toBe(
			true,
		);
	});

	it("shows 'Generating summary' once the reader view is ready and the summary is still pending", () => {
		const html = renderArticleBody({
			...baseInput,
			content: articleBody("<p>Body</p>"),
			crawl: { status: "ready" },
			summary: { status: "pending" },
			summaryPollUrl: "/queue/abc/summary?poll=1",
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("pending");
		expect(
			doc.querySelector("[data-test-summary-pending-title]")?.textContent,
		).toBe("Generating summary");
	});

	it("splices the injected action bars above the header and below the reader slot", () => {
		const html = renderArticleBody({
			...baseInput,
			content: articleBody("<p>Body</p>"),
			topActionsHtml: '<div data-test-top-actions>top</div>',
			bottomActionsHtml: '<div data-test-bottom-actions>bottom</div>',
		});
		const doc = parse(html);

		assert(doc.querySelector("[data-test-top-actions]"), "top actions must be spliced in");
		assert(doc.querySelector("[data-test-bottom-actions]"), "bottom actions must be spliced in");
		expect(html.indexOf("data-test-top-actions")).toBeLessThan(html.indexOf('id="article-header"'));
		expect(html.indexOf("data-test-bottom-actions")).toBeGreaterThan(html.indexOf("data-test-reader-content"));
	});

	it("leaves the rail's cards out of the article column, so the summary slot is followed directly by the reader slot", () => {
		const doc = parse(renderArticleBody({ ...baseInput, content: articleBody("<p>Body</p>") }));

		const summarySlot = doc.querySelector("#article-body-summary-slot");
		assert(summarySlot, "the summary slot must be rendered");
		expect(summarySlot.nextElementSibling?.id).toBe("article-body-reader-slot");
		expect(doc.querySelectorAll("[data-test-article-history]")).toHaveLength(0);
		expect(doc.querySelectorAll("[data-test-reader-topic-reads]")).toHaveLength(0);
	});

	it("renders the reader-pending slot when content is undefined and no crawl status is provided (read-after-write race)", () => {
		const html = renderArticleBody({
			...baseInput,
			content: undefined,
			readerPollUrl: "/queue/abc/reader?poll=1",
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/reader?poll=1");
	});

	it("renders the reader-pending slot with poll attributes when crawl is pending", () => {
		const html = renderArticleBody({
			...baseInput,
			content: undefined,
			crawl: { status: "pending" },
			readerPollUrl: "/queue/abc/reader?poll=1",
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/reader?poll=1");
		expect(slot.getAttribute("hx-trigger")).toBe("every 3s");
		expect(slot.getAttribute("hx-swap")).toBe("outerHTML");
		const bar = slot.querySelector('[data-test-progress-bar="reader"]');
		assert(bar, "the reader panel must carry its own progress block");
		expect(bar.classList.contains("article-body__progress--visible")).toBe(true);
	});

	it("renders the reader-failed slot when crawl status is failed", () => {
		const html = renderArticleBody({
			...baseInput,
			content: undefined,
			crawl: { status: "failed", reason: "exceeded SQS maxReceiveCount" },
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("failed");
		const notice = doc.querySelector("[data-test-reader-notice]");
		assert(notice, "the notice must be rendered");
		expect(notice.getAttribute("data-reader-status")).toBe("failed");
		const link = notice.querySelector("[data-test-reader-failed-primary]");
		expect(link?.getAttribute("href")).toBe("https://example.com/post");
	});

	it("wraps the header, the panels and the reader slot in one article card", () => {
		const html = renderArticleBody({
			...baseInput,
			content: articleBody("<p>Body</p>"),
			summary: { status: "ready", summary: "Key points." },
		});
		const doc = parse(html);

		const card = doc.querySelector("[data-test-article-card]");
		assert(card, "the article card must be rendered");
		expect(card.tagName).toBe("ARTICLE");
		expect(card.className).toBe("article-body__card article-body__card--article");
		const childIds = Array.from(card.children, (child) => child.id);
		expect(childIds).toEqual([
			"article-header",
			"article-body-summary-slot",
			"article-body-reader-slot",
		]);
	});

	it("places the supplied past reads in the article card between the summary slot and the reader slot", () => {
		const doc = parse(
			renderArticleBody({
				...baseInput,
				content: articleBody("<p>Body</p>"),
				previouslyReadHtml: '<section id="article-body-topic-reads-inline-slot">past reads</section>',
			}),
		);

		const card = doc.querySelector("[data-test-article-card]");
		assert(card, "the article card must be rendered");
		expect(Array.from(card.children, (child) => child.id)).toEqual([
			"article-header",
			"article-body-summary-slot",
			"article-body-topic-reads-inline-slot",
			"article-body-reader-slot",
		]);
	});

	it("orders the toolbar, the card, the notice, the issue links and the bottom bar, keeping the notice the card's next sibling", () => {
		const html = renderArticleBody({
			...baseInput,
			content: undefined,
			crawl: { status: "failed", reason: "exceeded SQS maxReceiveCount" },
			topActionsHtml: '<div data-test-top-actions>top</div>',
			issueLinksHtml: '<section data-test-issue-links>links</section>',
			bottomActionsHtml: '<div data-test-bottom-actions>bottom</div>',
		});
		const doc = parse(html);

		const order = Array.from(doc.body.children, (child) =>
			Array.from(child.attributes, (attribute) => attribute.name).find((name) => name.startsWith("data-test-")),
		);
		expect(order).toEqual([
			"data-test-top-actions",
			"data-test-article-card",
			"data-test-reader-notice",
			"data-test-issue-links",
			"data-test-bottom-actions",
		]);
		const card = doc.querySelector("[data-test-article-card]");
		assert(card, "the article card must be rendered");
		expect(card.nextElementSibling?.id).toBe("article-body-reader-notice");
	});

	it("leaves the table of contents to the rail, so the body carries only the anchored article", () => {
		const doc = parse(
			renderArticleBody({ ...baseInput, crawl: { status: "ready" }, content: articleBody("<h2>Why it matters</h2><p>One</p>") }),
		);

		const heading = doc.querySelector("[data-test-reader-content] h2");
		assert(heading, "the article's heading must be rendered");
		expect([heading.id, doc.querySelectorAll("[data-test-table-of-contents]").length]).toEqual([
			"section-why-it-matters",
			0,
		]);
	});

	it("renders the notice region hidden after the card while the reader view is ready", () => {
		const doc = parse(renderArticleBody({ ...baseInput, content: articleBody("<p>Body</p>") }));

		const notice = doc.querySelector("[data-test-reader-notice]");
		assert(notice, "the notice region must be rendered unconditionally");
		expect([notice.getAttribute("data-reader-status"), notice.className]).toEqual([
			"none",
			"article-body__reader-notice article-body__reader-notice--hidden",
		]);
		expect(notice.previousElementSibling?.hasAttribute("data-test-article-card")).toBe(true);
	});
});

describe("renderArticleRail", () => {
	const versions = [versionAt("2026-07-10T09:14Z"), versionAt("2026-06-28T22:01Z")];
	const pastReads = "<section data-test-reader-topic-reads>past reads</section>";
	const pendingReader: Pick<ArticleRailInput, "crawl" | "content" | "readerNotice" | "appOrigin"> = {
		crawl: { status: "pending" },
		content: undefined,
		readerNotice: undefined,
		appOrigin: "https://readplace.com",
	};
	const hiddenTableOfContents = { tag: "DIV", marker: "data-test-table-of-contents" };

	function railChildren(html: string): { tag: string; marker: string | undefined }[] {
		return Array.from(parse(html).body.children, (child) => ({
			tag: child.tagName,
			marker: Array.from(child.attributes, (attribute) => attribute.name).find((name) => name.startsWith("data-")),
		}));
	}

	function tableOfContentsState(html: string): string | null {
		const wrapper = parse(html).querySelector("#table-of-contents");
		assert(wrapper, "the table of contents wrapper must always be rendered");
		return wrapper.getAttribute("data-test-table-of-contents");
	}

	it("renders the Article history rows when versions are supplied", () => {
		const doc = parse(renderArticleRail({ ...pendingReader, crawlVersions: versions }));

		const keys = Array.from(doc.querySelectorAll("[data-test-article-history-version]"), (row) =>
			row.getAttribute("data-test-article-history-version"),
		);
		expect(keys).toEqual(["canonical", "2026-06-28T22:01Z"]);
	});

	it("renders only the hidden table of contents when the reader view is not ready and there is neither a version nor past reads", () => {
		expect([
			railChildren(renderArticleRail(pendingReader)),
			railChildren(renderArticleRail({ ...pendingReader, crawlVersions: [] })),
		]).toEqual([[hiddenTableOfContents], [hiddenTableOfContents]]);
	});

	it("stacks the table of contents, then Article history, then the past-reads section", () => {
		expect(
			railChildren(renderArticleRail({ ...pendingReader, crawlVersions: versions, previouslyReadHtml: pastReads })),
		).toEqual([
			hiddenTableOfContents,
			{ tag: "DETAILS", marker: "data-test-article-history" },
			{ tag: "SECTION", marker: "data-test-reader-topic-reads" },
		]);
	});

	it("renders the past-reads section after the table of contents when the article has no version", () => {
		expect(railChildren(renderArticleRail({ ...pendingReader, previouslyReadHtml: pastReads }))).toEqual([
			hiddenTableOfContents,
			{ tag: "SECTION", marker: "data-test-reader-topic-reads" },
		]);
	});

	it("lists the ready article's sections in the table of contents above Article history", () => {
		const html = renderArticleRail({
			crawl: { status: "ready" },
			content: articleBody("<h2>Why it matters</h2><p>One</p><h3>How to start</h3><p>Two</p>"),
			readerNotice: undefined,
			appOrigin: "https://readplace.com",
			crawlVersions: versions,
		});

		const rows = Array.from(parse(html).querySelectorAll("[data-test-toc-section]"), (row) =>
			row.getAttribute("href"),
		);
		expect([tableOfContentsState(html), rows]).toEqual([
			"listed",
			["#section-why-it-matters", "#section-how-to-start"],
		]);
		expect(railChildren(html)[0]).toEqual({ tag: "DIV", marker: "data-test-table-of-contents" });
	});

	it("shows the empty table of contents for a ready article with no h2 or h3", () => {
		const html = renderArticleRail({
			crawl: { status: "ready" },
			content: articleBody("<p>One paragraph</p><h4>A minor heading</h4>"),
			readerNotice: undefined,
			appOrigin: "https://readplace.com",
		});

		expect(tableOfContentsState(html)).toBe("empty");
	});

	it("keeps the table of contents hidden while the reader view is pending, after it failed, and for a link that is not an article", () => {
		const content = articleBody("<h2>Why it matters</h2><p>One</p>");

		expect([
			tableOfContentsState(renderArticleRail({ ...pendingReader, content })),
			tableOfContentsState(
				renderArticleRail({ ...pendingReader, crawl: { status: "failed", reason: "fetch-failed" } }),
			),
			tableOfContentsState(
				renderArticleRail({ ...pendingReader, crawl: { status: "ready" }, content, readerNotice: "not-an-article" }),
			),
		]).toEqual(["hidden", "hidden", "hidden"]);
	});

	it("hands the owner's removal controls to the row they authored", () => {
		const doc = parse(
			renderArticleRail({
				...pendingReader,
				crawlVersions: versions,
				articleHistoryRemoval: {
					authoredMinuteIds: ["2026-06-28T22:01Z"],
					removeVersionUrl: "/queue/abc/remove-my-version",
				},
			}),
		);

		const forms = Array.from(doc.querySelectorAll("form[data-test-article-history-remove]"));
		expect(forms.map((form) => form.getAttribute("action"))).toEqual(["/queue/abc/remove-my-version"]);
		expect(
			forms.map((form) =>
				form.closest("[data-test-article-history-version]")?.getAttribute("data-test-article-history-version"),
			),
		).toEqual(["2026-06-28T22:01Z"]);
	});

	it("places the stored copy's template between the two cards only when the page asks for it", () => {
		expect(
			railChildren(
				renderArticleRail({ ...pendingReader, crawlVersions: versions, offlineCopyRow: true, previouslyReadHtml: pastReads }),
			),
		).toEqual([
			hiddenTableOfContents,
			{ tag: "DETAILS", marker: "data-test-article-history" },
			{ tag: "TEMPLATE", marker: "data-offline-copy-template" },
			{ tag: "SECTION", marker: "data-test-reader-topic-reads" },
		]);
		expect(
			railChildren(
				renderArticleRail({ ...pendingReader, crawlVersions: versions, offlineCopyRow: false, previouslyReadHtml: pastReads }),
			),
		).toEqual([
			hiddenTableOfContents,
			{ tag: "DETAILS", marker: "data-test-article-history" },
			{ tag: "SECTION", marker: "data-test-reader-topic-reads" },
		]);
	});
});
