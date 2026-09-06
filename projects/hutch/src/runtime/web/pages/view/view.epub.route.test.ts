import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { strFromU8, unzipSync } from "fflate";
import type { ParseArticle } from "@packages/article-parser";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { calculateReadTime, type Minutes } from "@packages/domain/article";
import { useTestServer, BROWSER_REQUEST_HEADERS } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const ARTICLE_URL = "https://example.com/post";
const CANONICAL_PATH = "example.com/post";
const EPUB_PATH = `/view/${CANONICAL_PATH}?format=epub`;
const AZW3_PATH = `/view/${CANONICAL_PATH}?format=azw3`;
const IMAGE_FILENAME = "abcdef0123456789.jpg";
const IMAGE_SRC = ArticleResourceUniqueId.parse(ARTICLE_URL).toImageCdnUrl({
	baseUrl: "https://cdn.readplace.test",
	filename: IMAGE_FILENAME,
});

const useApp = useTestServer({
	convertEpubToAzw3: async () => new Uint8Array([0x41, 0x5a, 0x57, 0x33]),
});
const useDefaultAzw3App = useTestServer();
let countedAzw3Conversions = 0;
const useCountingAzw3App = useTestServer({
	convertEpubToAzw3: async () => {
		countedAzw3Conversions += 1;
		return new Uint8Array([0x41, 0x5a, 0x57, 0x33]);
	},
});
const useFailingAzw3App = useTestServer({
	convertEpubToAzw3: async () => {
		throw new Error("boko failed");
	},
});

function buildDownloadHarness(params?: {
	conversionFails?: boolean;
	countAzw3Conversions?: boolean;
	useDefaultAzw3Converter?: boolean;
	articleDownloadRule?: { limit: number; windowSeconds: number };
}) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	if (params?.articleDownloadRule) {
		fixture.rateLimit = {
			...fixture.rateLimit,
			rules: { ...fixture.rateLimit.rules, articleDownload: params.articleDownloadRule },
		};
	}
	const staleChecks: { url: string }[] = [];
	const parseArticle: ParseArticle = async () => ({
		ok: false,
		reason: "no-content",
	}) as Awaited<ReturnType<ParseArticle>>;
	const noop = async () => {};
	const mountApp = params?.conversionFails
		? useFailingAzw3App
		: params?.countAzw3Conversions
			? useCountingAzw3App
			: params?.useDefaultAzw3Converter
				? useDefaultAzw3App
			: useApp;
	const harness = mountApp({
		...fixture,
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
	return { harness, fixture, staleChecks };
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

	it("serves a ready article as an AZW3 file with the matching download headers", async () => {
		const { harness, fixture, staleChecks } = buildDownloadHarness();
		await seedReadyArticle(fixture);

		const response = await request(harness.server)
			.get(AZW3_PATH)
			.set(BROWSER_REQUEST_HEADERS)
			.buffer()
			.parse(binaryParser);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("application/vnd.amazon.mobi8-ebook");
		expect(response.headers["content-disposition"]).toBe('attachment; filename="hello-world.azw3"');
		expect(response.headers["cache-control"]).toBe("private, no-cache");
		expect(response.headers["x-robots-tag"]).toBe("noindex");
		expect(response.headers["content-signal"]).toBe("search=no, ai-input=no, ai-train=no");
		expect(response.body).toEqual(Buffer.from([0x41, 0x5a, 0x57, 0x33]));
		expect(staleChecks).toEqual([]);
		expect(harness.analytics.events.filter((e) => e.event === "view_opened")).toEqual([]);
		expect(lastViewCookie(response)).toBeUndefined();
	});

	it("gives generic test servers an AZW3 body rather than relabelling EPUB bytes", async () => {
		const { harness, fixture } = buildDownloadHarness({ useDefaultAzw3Converter: true });
		await seedReadyArticle(fixture);

		const response = await request(harness.server)
			.get(AZW3_PATH)
			.set(BROWSER_REQUEST_HEADERS)
			.buffer()
			.parse(binaryParser);

		expect(response.status).toBe(200);
		expect(response.body).toEqual(Buffer.from([0x41, 0x5a, 0x57, 0x33]));
	});

	it("limits repeated AZW3 conversions per network without limiting EPUB downloads", async () => {
		countedAzw3Conversions = 0;
		const { harness, fixture } = buildDownloadHarness({
			countAzw3Conversions: true,
			articleDownloadRule: { limit: 1, windowSeconds: 3600 },
		});
		await seedReadyArticle(fixture);

		const epub = await request(harness.server).get(EPUB_PATH).set(BROWSER_REQUEST_HEADERS);
		const firstAzw3 = await request(harness.server).get(AZW3_PATH).set(BROWSER_REQUEST_HEADERS);
		const secondAzw3 = await request(harness.server).get(AZW3_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(epub.status).toBe(200);
		expect(firstAzw3.status).toBe(200);
		expect(secondAzw3.status).toBe(429);
		expect(secondAzw3.headers["retry-after"]).toMatch(/^\d+$/);
		expect(countedAzw3Conversions).toBe(1);
	});

	it("does not convert downloads requested by a browser prefetch", async () => {
		countedAzw3Conversions = 0;
		const { harness, fixture } = buildDownloadHarness({ countAzw3Conversions: true });
		await seedReadyArticle(fixture);

		const response = await request(harness.server)
			.get(AZW3_PATH)
			.set(BROWSER_REQUEST_HEADERS)
			.set("Sec-Purpose", "prefetch");

		expect(response.status).toBe(204);
		expect(countedAzw3Conversions).toBe(0);
	});

	it("returns 404 without saving a stub or publishing a stale check for an unknown AZW3 article", async () => {
		const { harness, fixture, staleChecks } = buildDownloadHarness();

		const response = await request(harness.server).get(AZW3_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(404);
		expect(await fixture.articleStore.findArticleByUrl(ARTICLE_URL)).toBeNull();
		expect(staleChecks).toEqual([]);
		expect(harness.analytics.events.filter((e) => e.event === "view_opened")).toEqual([]);
		expect(lastViewCookie(response)).toBeUndefined();
	});

	it("returns 404 for either download format while an article has no content", async () => {
		const { harness, fixture } = buildDownloadHarness();
		await fixture.articleStore.saveArticleGlobally({
			url: ARTICLE_URL,
			metadata: { title: "Pending", siteName: "example.com", excerpt: "", wordCount: 0 },
			estimatedReadTime: calculateReadTime(0) as Minutes,
			savedAt: new Date("2026-09-02T00:00:00.000Z"),
		});

		for (const path of [EPUB_PATH, AZW3_PATH]) {
			const response = await request(harness.server).get(path).set(BROWSER_REQUEST_HEADERS);
			expect(response.status).toBe(404);
		}
	});

	it("returns 404 for either download format when the article is purged", async () => {
		const { harness, fixture } = buildDownloadHarness();
		await seedReadyArticle(fixture);
		await fixture.articleStore.setPurgedAt({ url: ARTICLE_URL, at: new Date("2026-09-02T01:00:00.000Z") });

		for (const path of [EPUB_PATH, AZW3_PATH]) {
			const response = await request(harness.server).get(path).set(BROWSER_REQUEST_HEADERS);
			expect(response.status).toBe(404);
		}
	});

	it("returns an error instead of falling back to EPUB when AZW3 conversion fails", async () => {
		const { harness, fixture } = buildDownloadHarness({ conversionFails: true });
		await seedReadyArticle(fixture);

		const response = await request(harness.server).get(AZW3_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(500);
	});

	it("treats an unrecognised format as a normal reader request", async () => {
		const { harness, fixture } = buildDownloadHarness();
		await seedReadyArticle(fixture);

		const response = await request(harness.server).get(`/view/${CANONICAL_PATH}?format=pdf&feature=epub`);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
		const doc = new JSDOM(response.text).window.document;
		const slot = doc.querySelector("[data-test-view-downloads-slot]");
		assert(slot, "the Download slot must render");
		expect(slot.classList.contains("view__downloads-slot--visible")).toBe(true);
	});

	it("shows Download with EPUB then AZW3 when the article is ready", async () => {
		const { harness, fixture } = buildDownloadHarness();
		await seedReadyArticle(fixture);

		const response = await request(harness.server).get(`/view/${CANONICAL_PATH}?feature=epub`);

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
			{
				format: "azw3",
				href: "/view/example.com/post?format=azw3&utm_source=view-article&utm_medium=internal&utm_content=download-azw3",
			},
		]);
	});

	it("keeps the Download slot hidden while the article is pending", async () => {
		const { harness } = buildDownloadHarness();

		const response = await request(harness.server).get(`/view/${CANONICAL_PATH}?feature=epub`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const slot = doc.querySelector("[data-test-view-downloads-slot]");
		assert(slot, "the Download slot must render");
		expect(slot.classList.contains("view__downloads-slot--hidden")).toBe(true);
	});

	it.each(["reader", "summary"])("reveals Download when the %s poll receives ready content", async (poll) => {
		const { harness, fixture } = buildDownloadHarness();
		const initial = await request(harness.server).get(`/view/${CANONICAL_PATH}?feature=epub`);
		const initialDocument = new JSDOM(initial.text).window.document;
		const initialSlot = initialDocument.querySelector("[data-test-view-downloads-slot]");
		assert(initialSlot, "the pending page must render a Download slot");
		const initialTarget = initialSlot.closest("#view-cta-downloads-slot");
		assert(initialTarget, "the pending Download slot must have a stable swap target");
		expect(initialSlot.classList.contains("view__downloads-slot--hidden")).toBe(true);
		const initialPollUrls = Array.from(initialDocument.querySelectorAll("#article-body-reader-slot[hx-get], #article-body-summary-slot[hx-get]"), (element) => new URL(element.getAttribute("hx-get") ?? "", TEST_APP_ORIGIN));
		expect(initialPollUrls.map((url) => url.searchParams.get("feature"))).toEqual(["epub", "epub"]);

		await seedReadyArticle(fixture);
		await fixture.articleCrawl.markCrawlReady({ url: ARTICLE_URL });
		const response = await request(harness.server).get(
			`/view/${poll}?url=${encodeURIComponent(ARTICLE_URL)}&poll=1&feature=epub`,
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
			{
				format: "azw3",
				href: "/view/example.com/post?format=azw3&utm_source=view-article&utm_medium=internal&utm_content=download-azw3",
			},
		]);
	});

	it.each(["", "?feature=other"])("hides ready downloads without the EPUB feature: %s", async (query) => {
		const { harness, fixture } = buildDownloadHarness();
		await seedReadyArticle(fixture);

		const response = await request(harness.server).get(`/view/${CANONICAL_PATH}${query}`);

		expect(response.status).toBe(200);
		const slot = new JSDOM(response.text).window.document.querySelector("[data-test-view-downloads-slot]");
		assert(slot, "the public page must render a downloads slot");
		expect(slot.classList.contains("view__downloads-slot--hidden")).toBe(true);
	});

	it.each(["reader", "summary"])("keeps the default %s poll scoped to the reader without downloads", async (poll) => {
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
		]);
	});
});
