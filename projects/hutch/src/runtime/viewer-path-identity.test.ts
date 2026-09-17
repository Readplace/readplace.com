import request from "supertest";
import assert from "node:assert";
import { JSDOM } from "jsdom";
import { strFromU8, unzipSync } from "fflate";
import { createDefaultTestAppFixture, TEST_APP_ORIGIN } from "@packages/test-fixtures";
import { calculateReadTime } from "@packages/domain/article";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { useTestServer, BROWSER_REQUEST_HEADERS } from "./test-app";
import { throughEdge } from "./viewer-path.test-helper";
import { viewPathFor } from "./web/pages/view/view-path";

const useApp = useTestServer();
const ORIGINAL = "https://example.com/article/https://embedded.example/story";
const SIBLING = ORIGINAL.replace("/https://", "/https:/");
const IMAGE = "abcdef0123456789.jpg";

it("downloads the original from rendered owner, public and poll links even with a conflicting collapsed sibling", async () => {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const crawl = jest.fn(async () => {});
	const stale = jest.fn(async () => {});
	const harness = useApp({ ...fixture, events: { ...fixture.events, publishLinkSaved: crawl, publishSaveAnonymousLink: crawl, publishStaleCheckRequested: stale } });
	const user = await harness.auth.createUser({ email: "transport@example.com", password: "password123" });
	assert(user.ok);
	const userId = user.userId;
	const sid = await harness.auth.createSession({ userId, emailVerified: true });
	const headers = { ...BROWSER_REQUEST_HEADERS, cookie: `hutch_sid=${sid}` };
	async function seed(url: string, title: string, body: string, bytes: number[]) {
		const { saved } = await fixture.articleStore.saveArticle({ userId, url, metadata: { title, siteName: "example.com", excerpt: `${title} excerpt`, wordCount: 30 }, estimatedReadTime: calculateReadTime(30), savedAt: new Date(), provenance: { kind: "web" } });
		const src = ArticleResourceUniqueId.parse(url).toImageCdnUrl({ baseUrl: "https://cdn.readplace.test", filename: IMAGE });
		await fixture.articleStore.writeContent({ url, content: `<p>${body}</p><img src="${src}">` });
		await fixture.articleStore.writeImage({ url, filename: IMAGE, body: Buffer.from(bytes), contentType: "image/jpeg" });
		await fixture.articleCrawl.markCrawlReady({ url });
		return saved.id;
	}
	const id = await seed(ORIGINAL, "Original title", "ORIGINAL BODY", [1, 2, 3]);
	async function link(path: string, selector: string) {
		const response = await throughEdge(harness.app, path, { headers });
		expect(response.statusCode).toBe(200);
		const href = new JSDOM(response.body).window.document.querySelector(selector)?.getAttribute("href");
		assert(href, `rendered ${path} must offer a download`);
		expect(new URL(href, TEST_APP_ORIGIN).pathname).toBe(viewPathFor(ORIGINAL));
		return href;
	}
	async function download(href: string) {
		crawl.mockClear(); stale.mockClear();
		const response = await throughEdge(harness.app, href, { headers });
		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toBe("application/epub+zip");
		expect(response.isBase64Encoded).toBe(true);
		const files = unzipSync(Buffer.from(response.body, "base64"));
		expect(strFromU8(files.mimetype)).toBe("application/epub+zip");
		const content = strFromU8(files["OEBPS/content.xhtml"]);
		expect(content).toContain("Original title");
		expect(content).toContain("ORIGINAL BODY");
		expect(content).not.toContain("SIBLING");
		const opf = Object.keys(files).find((name) => name.endsWith(".opf"));
		assert(opf);
		expect(strFromU8(files[opf])).toContain("Original title");
		expect(files[`OEBPS/images/${IMAGE}`]).toEqual(new Uint8Array([1, 2, 3]));
		expect(crawl).not.toHaveBeenCalled();
		expect(stale).not.toHaveBeenCalled();
	}
	// Freeze the established router/codec semantics against direct application requests.
	await seed("https://example.com/compatibility", "Compatibility title", "COMPATIBILITY BODY", [7]);
	for (const [path, method, accept] of [
		["/view?url=https%3A%2F%2Fexample.com%2Fcompatibility", "GET", "text/html"],
		["/view/?url=https%3A%2F%2Fexample.com%2Fcompatibility", "GET", "text/html"],
		["/VIEW/HTTPS://example.com/compatibility?x=&x=two+words&flag", "GET", "text/html"],
		["/view/http://example.com/compatibility", "HEAD", "text/html"],
		["/view/http%3A%2F%2Fexample.com/compatibility", "GET", "text/html"],
		["/view/example.com/a%2Fb%3Fc%3Dd", "HEAD", "text/html"],
		["/view/example.com/compatibility", "HEAD", "text/html"],
		["/view/example.com/compatibility", "POST", "text/html"],
		["/view/example.com/compatibility", "GET", "text/markdown"],
	]) {
		const direct = await (method === "HEAD" ? request(harness.server).head(path) : method === "POST" ? request(harness.server).post(path) : request(harness.server).get(path)).set("Accept", accept);
		const transported = await throughEdge(harness.app, path, { method, headers: { accept } });
		expect(transported.statusCode).toBe(direct.status);
		expect(transported.headers.location).toBe(direct.headers.location);
		expect(transported.headers["content-type"]).toBe(direct.headers["content-type"]);
		if (accept === "text/markdown") expect(transported.body).toContain("COMPATIBILITY BODY");
	}
	const owner = `/queue/${id}/view`;
	const href = await link(owner, '[data-test-download="epub"]');
	expect((await throughEdge(harness.app, href, { preservation: false })).statusCode).toBe(404);
	await download(href);
	expect(await fixture.articleStore.findArticleByUrl(SIBLING)).toBeNull();
	await seed(SIBLING, "SIBLING title", "SIBLING BODY", [4, 5, 6]);
	await download(href);
	const broken = await throughEdge(harness.app, href, { preservation: false });
	expect(broken.statusCode).toBe(200);
	expect(strFromU8(unzipSync(Buffer.from(broken.body, "base64"))["OEBPS/content.xhtml"])).toContain("SIBLING BODY");
	await download(await link(viewPathFor(ORIGINAL), '[data-test-view-download="epub"]'));
	expect(harness.analytics.events).toContainEqual(expect.objectContaining({ event: "view_opened", path: viewPathFor(ORIGINAL) }));
	for (const poll of ["reader", "summary"]) {
		await download(await link(`/view/${poll}?url=${encodeURIComponent(ORIGINAL)}&poll=1`, '[data-test-view-download="epub"]'));
		await download(await link(`/queue/${id}/${poll}?poll=1`, '[data-test-download="epub"]'));
	}
	const missingUrl = `${ORIGINAL}-missing`;
	crawl.mockClear(); stale.mockClear();
	expect((await throughEdge(harness.app, `${viewPathFor(missingUrl)}?format=epub`)).statusCode).toBe(404);
	expect(await fixture.articleStore.findArticleByUrl(missingUrl)).toBeNull();
	expect(crawl).not.toHaveBeenCalled();
	expect(stale).not.toHaveBeenCalled();
	expect((await throughEdge(harness.app, href, { headers: { "sec-purpose": "prefetch" } })).statusCode).toBe(204);
	const pendingUrl = `${ORIGINAL}-pending`;
	await fixture.articleStore.saveArticleGlobally({ url: pendingUrl, metadata: { title: "Pending", siteName: "example.com", excerpt: "", wordCount: 0 }, estimatedReadTime: calculateReadTime(0), savedAt: new Date() });
	expect((await throughEdge(harness.app, `${viewPathFor(pendingUrl)}?format=epub`)).statusCode).toBe(404);
	await fixture.articleStore.setPurgedAt({ url: ORIGINAL, at: new Date() });
	expect((await throughEdge(harness.app, href)).statusCode).toBe(404);
});
