import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { DOMParser } from "linkedom";
import request from "supertest";
import { strFromU8, unzipSync } from "fflate";
import type { ParseArticle } from "@packages/article-parser";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { calculateReadTime, type Minutes } from "@packages/domain/article";
import { useTestServer, BROWSER_REQUEST_HEADERS } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeSummaryProvider,
} from "@packages/test-fixtures";

const ARTICLE_URL = "https://example.com/post";
const CANONICAL_PATH = "example.com/post";
const EPUB_PATH = `/view/${CANONICAL_PATH}?format=epub`;
const IMAGE_FILENAME = "abcdef0123456789.jpg";
const IMAGE_SRC = ArticleResourceUniqueId.parse(ARTICLE_URL).toImageCdnUrl({
	baseUrl: "https://cdn.readplace.test",
	filename: IMAGE_FILENAME,
});

const useApp = useTestServer();

function buildDownloadHarness() {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const contentReads: string[] = [];
	const readArticleContent = fixture.articleStore.readArticleContent;
	fixture.articleStore = {
		...fixture.articleStore,
		readArticleContent: async (url: string) => {
			contentReads.push(url);
			return readArticleContent(url);
		},
	};
	const staleChecks: { url: string }[] = [];
	const parseArticle: ParseArticle = async () => ({
		ok: false,
		reason: "no-content",
	}) as Awaited<ReturnType<ParseArticle>>;
	const noop = async () => {};
	const summary = createFakeSummaryProvider();
	const harness = useApp({
		...fixture,
		summary,
		parser: { parseArticle, crawlArticle: fixture.parser.crawlArticle },
		events: {
			...fixture.events,
			publishLinkSaved: noop,
			publishSaveAnonymousLink: noop,
			publishStaleCheckRequested: async (params: { url: string }) => {
				staleChecks.push(params);
				await fixture.events.publishStaleCheckRequested(params);
			},
		},
	});
	return { harness, fixture, staleChecks, summary, contentReads };
}

async function seedReadyArticle(fixture: ReturnType<typeof createDefaultTestAppFixture>) {
	await fixture.articleStore.saveArticleGlobally({
		url: ARTICLE_URL,
		metadata: { title: "Hello World", siteName: "example.com", excerpt: "x", wordCount: 3 },
		estimatedReadTime: calculateReadTime(3) as Minutes,
		savedAt: new Date("2026-09-02T00:00:00.000Z"),
	});
	await fixture.articleStore.writeContent({
		url: ARTICLE_URL,
		content: `<p>Body copy.</p><p><img src="${IMAGE_SRC}"></p>`,
	});
	await fixture.articleStore.writeImage({
		url: ARTICLE_URL,
		filename: IMAGE_FILENAME,
		body: Buffer.from([1, 2, 3]),
		contentType: "image/jpeg",
	});
}

function lastViewCookie(response: request.Response): string | undefined {
	const setCookie = response.headers["set-cookie"];
	return (Array.isArray(setCookie) ? setCookie : []).find((c) => c.startsWith("hutch_lastview="));
}

function contentOutline(epub: Uint8Array): [string, string][] {
	const xhtml = strFromU8(unzipSync(epub)["OEBPS/content.xhtml"]);
	const document = new DOMParser().parseFromString(xhtml, "text/xml");
	const body = document.querySelector("body");
	assert(body, "content.xhtml must carry a body");
	return Array.from(body.children, (element) => [element.localName, element.textContent]);
}

function binaryParser(res: unknown, callback: (err: Error | null, body: Buffer) => void): void {
	const stream = res as NodeJS.ReadableStream;
	const chunks: Buffer[] = [];
	stream.on("data", (chunk) => chunks.push(Buffer.from(chunk as Buffer)));
	stream.on("end", () => callback(null, Buffer.concat(chunks)));
}

describe("GET /view/<url>?format=<download>", () => {
	it("serves a ready article as an EPUB file with the embedded image and no-index headers", async () => {
		const { harness, fixture, staleChecks } = buildDownloadHarness();
		await seedReadyArticle(fixture);

		const response = await request(harness.server)
			.get(EPUB_PATH)
			.set(BROWSER_REQUEST_HEADERS)
			.buffer()
			.parse(binaryParser);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("application/epub+zip");
		expect(response.headers["content-disposition"]).toBe('attachment; filename="hello-world.epub"');
		expect(response.headers["cache-control"]).toBe("private, no-cache");
		expect(response.headers["x-robots-tag"]).toBe("noindex");
		expect(response.headers["content-signal"]).toBe("search=no, ai-input=no, ai-train=no");

		const body: Buffer = response.body;
		expect([body[0], body[1], body[2], body[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);

		const files = unzipSync(new Uint8Array(body));
		expect(strFromU8(files.mimetype)).toBe("application/epub+zip");
		const contentXhtml = strFromU8(files["OEBPS/content.xhtml"]);
		expect(contentXhtml).toContain("Body copy.");
		expect(contentXhtml).toContain(`images/${IMAGE_FILENAME}`);
		expect(files[`OEBPS/images/${IMAGE_FILENAME}`]).toEqual(new Uint8Array([1, 2, 3]));

		expect(staleChecks).toEqual([]);
		expect(harness.analytics.events.filter((e) => e.event === "view_opened")).toEqual([]);
		expect(lastViewCookie(response)).toBeUndefined();
	});

	it("opens the EPUB with the title, site name and parsed excerpt while the summary is pending", async () => {
		const { harness, fixture, summary } = buildDownloadHarness();
		await seedReadyArticle(fixture);
		await summary.markSummaryPending({ url: ARTICLE_URL });

		const response = await request(harness.server)
			.get(EPUB_PATH)
			.set(BROWSER_REQUEST_HEADERS)
			.buffer()
			.parse(binaryParser);

		expect(response.status).toBe(200);
		expect(contentOutline(new Uint8Array(response.body))).toEqual([
			["h1", "Hello World"],
			["p", "example.com"],
			["p", "x"],
			["hr", ""],
			["p", "Body copy."],
			["p", ""],
		]);
	});

	it("adds the generated excerpt and the summary to a download taken after the summary lands", async () => {
		const { harness, fixture, summary } = buildDownloadHarness();
		await seedReadyArticle(fixture);
		await summary.markSummaryPending({ url: ARTICLE_URL });

		const beforeSummary = await request(harness.server)
			.get(EPUB_PATH)
			.set(BROWSER_REQUEST_HEADERS)
			.buffer()
			.parse(binaryParser);
		summary.markSummaryReady({
			url: ARTICLE_URL,
			summary: "First point.\n\nSecond point.",
			excerpt: "Generated blurb.",
		});
		const afterSummary = await request(harness.server)
			.get(EPUB_PATH)
			.set(BROWSER_REQUEST_HEADERS)
			.buffer()
			.parse(binaryParser);

		expect(contentOutline(new Uint8Array(beforeSummary.body))).toEqual([
			["h1", "Hello World"],
			["p", "example.com"],
			["p", "x"],
			["hr", ""],
			["p", "Body copy."],
			["p", ""],
		]);
		expect(contentOutline(new Uint8Array(afterSummary.body))).toEqual([
			["h1", "Hello World"],
			["p", "example.com"],
			["p", "Generated blurb."],
			["h2", "Summary (TL;DR)"],
			["p", "First point."],
			["p", "Second point."],
			["hr", ""],
			["p", "Body copy."],
			["p", ""],
		]);
	});

	it("does not build a download requested by a browser prefetch", async () => {
		const { harness, fixture, contentReads } = buildDownloadHarness();
		await seedReadyArticle(fixture);

		const response = await request(harness.server)
			.get(EPUB_PATH)
			.set(BROWSER_REQUEST_HEADERS)
			.set("Sec-Purpose", "prefetch");

		expect(response.status).toBe(204);
		expect(contentReads).toEqual([]);
	});

	it("returns 404 without saving a stub or publishing a stale check for an unknown article", async () => {
		const { harness, fixture, staleChecks } = buildDownloadHarness();

		const response = await request(harness.server).get(EPUB_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(404);
		expect(await fixture.articleStore.findArticleByUrl(ARTICLE_URL)).toBeNull();
		expect(staleChecks).toEqual([]);
		expect(harness.analytics.events.filter((e) => e.event === "view_opened")).toEqual([]);
		expect(lastViewCookie(response)).toBeUndefined();
	});

	it("returns 404 while an article has no content", async () => {
		const { harness, fixture } = buildDownloadHarness();
		await fixture.articleStore.saveArticleGlobally({
			url: ARTICLE_URL,
			metadata: { title: "Pending", siteName: "example.com", excerpt: "", wordCount: 0 },
			estimatedReadTime: calculateReadTime(0) as Minutes,
			savedAt: new Date("2026-09-02T00:00:00.000Z"),
		});

		const response = await request(harness.server).get(EPUB_PATH).set(BROWSER_REQUEST_HEADERS);
		expect(response.status).toBe(404);
	});

	it("returns 404 when the article is purged", async () => {
		const { harness, fixture } = buildDownloadHarness();
		await seedReadyArticle(fixture);
		await fixture.articleStore.setPurgedAt({ url: ARTICLE_URL, at: new Date("2026-09-02T01:00:00.000Z") });

		const response = await request(harness.server).get(EPUB_PATH).set(BROWSER_REQUEST_HEADERS);
		expect(response.status).toBe(404);
	});

	it("treats an unrecognised format as a normal reader request", async () => {
		const { harness, fixture } = buildDownloadHarness();
		await seedReadyArticle(fixture);

		const response = await request(harness.server).get(`/view/${CANONICAL_PATH}?format=pdf`);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
		const doc = new JSDOM(response.text).window.document;
		const slot = doc.querySelector("[data-test-view-downloads-slot]");
		assert(slot, "the Download slot must render");
		expect(slot.classList.contains("view__downloads-slot--visible")).toBe(true);
	});

	it("shows the EPUB download to everyone when the article is ready", async () => {
		const { harness, fixture } = buildDownloadHarness();
		await seedReadyArticle(fixture);

		const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const slot = doc.querySelector("[data-test-view-downloads-slot]");
		assert(slot, "the Download slot must render");
		expect(slot.classList.contains("view__downloads-slot--visible")).toBe(true);
		expect(
			Array.from(doc.querySelectorAll("[data-test-view-download]"), (link) => ({
				format: link.getAttribute("data-test-view-download"),
				href: link.getAttribute("href"),
			})),
		).toEqual([
			{
				format: "epub",
				href: "/view/example.com/post?format=epub&utm_source=view-article&utm_medium=internal&utm_content=download-epub",
			},
		]);
	});

	it("keeps the Download slot hidden while the article is pending", async () => {
		const { harness } = buildDownloadHarness();

		const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const slot = doc.querySelector("[data-test-view-downloads-slot]");
		assert(slot, "the Download slot must render");
		expect(slot.classList.contains("view__downloads-slot--hidden")).toBe(true);
	});

	it.each(["reader", "summary"])("reveals Download when the %s poll receives ready content", async (poll) => {
		const { harness, fixture } = buildDownloadHarness();
		const initial = await request(harness.server).get(`/view/${CANONICAL_PATH}`);
		const initialDocument = new JSDOM(initial.text).window.document;
		const initialSlot = initialDocument.querySelector("[data-test-view-downloads-slot]");
		assert(initialSlot, "the pending page must render a Download slot");
		const initialTarget = initialSlot.closest("#view-cta-downloads-slot");
		assert(initialTarget, "the pending Download slot must have a stable swap target");
		expect(initialSlot.classList.contains("view__downloads-slot--hidden")).toBe(true);
		await seedReadyArticle(fixture);
		await fixture.articleCrawl.markCrawlReady({ url: ARTICLE_URL });
		const response = await request(harness.server).get(
			`/view/${poll}?url=${encodeURIComponent(ARTICLE_URL)}&poll=1`,
		);

		expect(response.status).toBe(200);
		const document = new JSDOM(response.text).window.document;
		const slot = document.querySelector("[data-test-view-downloads-slot]");
		assert(slot, "a ready poll must update the Download slot");
		const target = slot.closest("#view-cta-downloads-slot");
		assert(target, "a ready poll must target the pending Download wrapper");
		expect(target.id).toBe(initialTarget.id);
		expect(target.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(slot.classList.contains("view__downloads-slot--visible")).toBe(true);
		expect(Array.from(slot.querySelectorAll("[data-test-view-download]"), (link) => ({
			format: link.getAttribute("data-test-view-download"),
			href: link.getAttribute("href"),
		}))).toEqual([
			{
				format: "epub",
				href: "/view/example.com/post?format=epub&utm_source=view-article&utm_medium=internal&utm_content=download-epub",
			},
		]);
	});

	it.each(["reader", "summary"])("swaps the Download slot alongside the %s poll on a ready article", async (poll) => {
		const { harness, fixture } = buildDownloadHarness();
		await seedReadyArticle(fixture);
		const response = await request(harness.server).get(`/view/${poll}?url=${encodeURIComponent(ARTICLE_URL)}&poll=1`);

		expect(response.status).toBe(200);
		const document = new JSDOM(response.text).window.document;
		expect(Array.from(document.querySelectorAll("[hx-swap-oob]"), (element) => element.id)).toEqual([
			poll === "reader" ? "article-body-summary-slot" : "article-body-reader-slot",
			"article-body-progress",
			"article-header",
			"document-title",
			"view-cta-downloads-slot",
		]);
	});
});
