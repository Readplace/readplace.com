/* c8 ignore start -- mandatory deployed CloudFront/API Gateway/Lambda identity gate */
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { JSDOM } from "jsdom";
import { strFromU8, unzipSync } from "fflate";

const ORIGIN = "https://readplace-staging.com";
const SIREN = "application/vnd.siren+json";

test("preserves reader and EPUB identity through the public staging CDN", async () => {
	test.setTimeout(300000);
	// Deliberately the public domain: an execute-api baseURL would bypass the fix.
	const owner = await playwrightRequest.newContext({ baseURL: ORIGIN });
	const publicReader = await playwrightRequest.newContext({ baseURL: ORIGIN });
	const run = randomUUID();
	const original = `${ORIGIN}/reader-path-check/${run}/https://embedded.example/article`;
	const sibling = original.replace("/https://", "/https:/");
	const originalTitle = `Original ${run}`;
	const siblingTitle = `Sibling ${run}`;
	const marker = `ORIGINAL-BODY-${run}`;
	const other = `SIBLING-BODY-${run}`;
	const pathFor = (url: string) => `/view/${url.slice("https://".length)}`;
	const doc = (html: string) => new JSDOM(html).window.document;
	async function download(href: string, title: string, body: string, excluded: string) {
		const response = await publicReader.get(href);
		expect(response.status(), `EPUB identity failed for ${href}`).toBe(200);
		expect(response.headers()["content-type"]).toBe("application/epub+zip");
		const files = unzipSync(await response.body());
		expect(strFromU8(files.mimetype)).toBe("application/epub+zip");
		const contents = strFromU8(files["OEBPS/content.xhtml"]);
		expect(contents).toContain(title);
		expect(contents).toContain(body);
		expect(contents).not.toContain(excluded);
		const opf = Object.keys(files).find((name) => name.endsWith(".opf"));
		assert(opf);
		expect(strFromU8(files[opf])).toContain(title);
	}
	async function readyReader(client: APIRequestContext, href: string, body: string) {
		let html = "";
		await expect.poll(async () => {
			const response = await client.get(href);
			expect(response.status()).toBe(200);
			html = await response.text();
			return doc(html).querySelector("[data-article-body]")?.textContent ?? html;
		}, { timeout: 120000, intervals: [1000, 2000, 5000] }).toContain(body);
		return doc(html);
	}
	try {
		const email = `reader-path-${run}@example.com`;
		const signup = await owner.post("/signup", { form: { email, password: "test-password-123", website: "", loadedAt: String(Date.now() - 8000) }, maxRedirects: 0 });
		expect(signup.status()).toBe(303);
		const verifier = randomBytes(48).toString("base64url");
		const authorization = await owner.post("/oauth/authorize", { form: {
			client_id: "ios-app", redirect_uri: "readplace://oauth-callback", response_type: "code",
			code_challenge: createHash("sha256").update(verifier).digest("base64url"),
			code_challenge_method: "S256", state: run, action: "approve",
		}, maxRedirects: 0 });
		expect(authorization.status()).toBe(302);
		const code = new URL(authorization.headers().location).searchParams.get("code");
		assert(code);
		const exchange = await owner.post("/oauth/token", { form: { grant_type: "authorization_code", code, redirect_uri: "readplace://oauth-callback", client_id: "ios-app", code_verifier: verifier } });
		expect(exchange.status()).toBe(200);
		const token = (await exchange.json()).access_token;
		const apiHeaders = { accept: SIREN, authorization: `Bearer ${token}` };
		const collection = await owner.get("/queue", { headers: apiHeaders });
		expect(collection.status()).toBe(200);
		const entity = await collection.json();
		const save = entity.actions.find((a: { name: string }) => a.name === "save-content");
		assert(save, "authenticated Siren collection must advertise save-content");
		async function upload(url: string, title: string, body: string) {
			const html = `<html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${body}</p><p>${("This controlled article verifies that reader downloads preserve the source URL and select the correct stored article. ").repeat(20)}</p><p>${body}</p></article></body></html>`;
			const response = await owner.fetch(save.href, { method: save.method, headers: apiHeaders, multipart: { url, title, mediaType: "text/html", content: { name: "article.html", mimeType: "text/html", buffer: Buffer.from(html) } } });
			expect(response.status()).toBe(201);
			const saved = await response.json();
			expect(saved.properties.url).toBe(url);
			const reader = saved.links.find((link: { rel: string[] }) => link.rel.includes("read"))?.href;
			assert(reader, "save response must advertise the owner reader");
			return reader as string;
		}
		const ownerHref = await upload(original, originalTitle, marker);
		const ownerDoc = await readyReader(owner, ownerHref, marker);
		const epub = ownerDoc.querySelector('[data-test-download="epub"]')?.getAttribute("href");
		assert(epub, "owner reader must render its actual EPUB link");
		expect(new URL(epub, ORIGIN).pathname).toBe(pathFor(original));
		// First download BEFORE public HTML could create the collapsed sibling.
		await download(epub, originalTitle, marker, other);
		const siblingHref = await upload(sibling, siblingTitle, other);
		await readyReader(owner, siblingHref, other);
		await download(epub, originalTitle, marker, other);
		const publicDoc = await readyReader(publicReader, pathFor(original), marker);
		expect(publicDoc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(original);
		expect(publicDoc.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(`https://readplace.com${pathFor(original)}`);
		const shares = publicDoc.querySelectorAll("[data-share-url]");
		expect(shares.length).toBeGreaterThanOrEqual(2);
		for (const share of shares) {
			expect(new URL(share.getAttribute("data-share-url") ?? "").pathname).toBe(pathFor(original));
		}
		const publicEpub = publicDoc.querySelector('[data-test-view-download="epub"]')?.getAttribute("href");
		assert(publicEpub);
		await download(publicEpub, originalTitle, marker, other);
		const missing = await publicReader.get(`${pathFor(original)}-missing?format=epub`);
		expect(missing.status()).toBe(404);
		await download(epub, originalTitle, marker, other);
		await Promise.all([download(epub, originalTitle, marker, other), download(`${pathFor(sibling)}?format=epub`, siblingTitle, other, marker)]);
		for (const size of [5000, 7800]) {
			const longPath = `/view/readplace-staging.com/reader-path-check/${run}/${"a".repeat(size)}`;
			const response = await publicReader.get(`${longPath}?format=epub`, { headers: { cookie: `reader_path_check=${"c".repeat(500)}` } });
			expect(response.status(), "long reader URL must reach the application without transport-size failure").toBe(404);
		}
		await download(epub, originalTitle, marker, other);
		const query = "?utm_source=reader-path-check&x=&x=2";
		const redirect = await publicReader.get(`/view/https://${original.slice(8)}${query}`, { maxRedirects: 0 });
		expect(redirect.status()).toBe(301);
		expect(redirect.headers().location).toBe(pathFor(original) + query);
		const ownerUrl = new URL(ownerHref, ORIGIN);
		const legacyReader = await owner.get(ownerUrl.pathname.replace(/\/view$/, "/read") + query, { maxRedirects: 0 });
		expect(legacyReader.status()).toBe(301);
		expect(legacyReader.headers().location).toBe(ownerUrl.pathname + query);
		for (const path of ["/", "/privacy", "/embed/icon.svg"]) expect((await publicReader.get(path)).status()).toBe(200);
		const legacyHost = await publicReader.get("https://www.readplace-staging.com/privacy", { maxRedirects: 0 });
		expect([301, 302, 308]).toContain(legacyHost.status());
		expect(legacyHost.headers().location).toBe(`${ORIGIN}/privacy`);
	} finally {
		await owner.dispose();
		await publicReader.dispose();
	}
});
/* c8 ignore stop */
