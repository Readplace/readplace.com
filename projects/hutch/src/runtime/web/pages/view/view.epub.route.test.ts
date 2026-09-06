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
const IMAGE_FILENAME = "abcdef0123456789.jpg";
const IMAGE_SRC = ArticleResourceUniqueId.parse(ARTICLE_URL).toImageCdnUrl({
	baseUrl: "https://cdn.readplace.test",
	filename: IMAGE_FILENAME,
});

const useApp = useTestServer();

function buildEpubHarness() {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const staleChecks: { url: string }[] = [];
	const parseArticle: ParseArticle = async () => ({
		ok: false,
		reason: "no-content",
	}) as Awaited<ReturnType<ParseArticle>>;
	const noop = async () => {};
	const harness = useApp({
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

describe("GET /view/<url>?format=epub", () => {
	it("serves a ready article as an EPUB file with the embedded image and no-index headers", async () => {
		const { harness, fixture, staleChecks } = buildEpubHarness();
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

	it("returns 404 without saving a stub or publishing a stale check for an unknown article", async () => {
		const { harness, fixture, staleChecks } = buildEpubHarness();

		const response = await request(harness.server).get(EPUB_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(404);
		expect(await fixture.articleStore.findArticleByUrl(ARTICLE_URL)).toBeNull();
		expect(staleChecks).toEqual([]);
		expect(harness.analytics.events.filter((e) => e.event === "view_opened")).toEqual([]);
		expect(lastViewCookie(response)).toBeUndefined();
	});

	it("returns 404 for an article saved but not yet crawled (no content)", async () => {
		const { harness, fixture } = buildEpubHarness();
		await fixture.articleStore.saveArticleGlobally({
			url: ARTICLE_URL,
			metadata: { title: "Pending", siteName: "example.com", excerpt: "", wordCount: 0 },
			estimatedReadTime: calculateReadTime(0) as Minutes,
			savedAt: new Date("2026-09-02T00:00:00.000Z"),
		});

		const response = await request(harness.server).get(EPUB_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(404);
	});

	it("returns 404 for a purged article", async () => {
		const { harness, fixture } = buildEpubHarness();
		await seedReadyArticle(fixture);
		await fixture.articleStore.setPurgedAt({ url: ARTICLE_URL, at: new Date("2026-09-02T01:00:00.000Z") });

		const response = await request(harness.server).get(EPUB_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(404);
	});

	function ctaKeys(doc: Document): string[] {
		return Array.from(doc.querySelectorAll("[data-test-view-cta-action]"), (el) => el.id);
	}

	it("shows the Download EPUB control when the article is ready and the feature is revealed", async () => {
		const { harness, fixture } = buildEpubHarness();
		await seedReadyArticle(fixture);

		const response = await request(harness.server).get(`/view/${CANONICAL_PATH}?feature=epub`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(ctaKeys(doc)).toContain("view-cta-download-epub");
		const cta = doc.querySelector("#view-cta-download-epub");
		assert(cta, "the download-epub CTA must render when revealed");
		expect(cta.getAttribute("href")).toContain("format=epub");
	});

	it("omits the Download EPUB control when the feature is not revealed", async () => {
		const { harness, fixture } = buildEpubHarness();
		await seedReadyArticle(fixture);

		const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(ctaKeys(doc)).toEqual(["view-cta-save", "view-cta-paste-another-link"]);
	});

	it("omits the Download EPUB control while the article is pending", async () => {
		const { harness } = buildEpubHarness();

		const response = await request(harness.server).get(`/view/${CANONICAL_PATH}?feature=epub`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(ctaKeys(doc)).not.toContain("view-cta-download-epub");
	});
});
