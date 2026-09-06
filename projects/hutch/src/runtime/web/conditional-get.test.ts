import type { ConditionalGetRequest } from "./conditional-get";
import { CacheableComponent, FreshForComponent } from "./conditional-get";
import { generateCspNonce, HtmlPage } from "@packages/web-shell";
import type { Component, CspNonce } from "@packages/web-shell";

function fakeReq(headers: Record<string, string> = {}): ConditionalGetRequest {
	return { headers };
}

function htmlComponent(body: string): Component {
	return HtmlPage(body);
}

function htmlWithNonce(nonce: CspNonce, marker = "row"): Component {
	return HtmlPage(`<style nonce="${nonce}"></style><main>${marker}</main>`);
}

const MAX_AGE_5 = "private, max-age=5";

describe("CacheableComponent", () => {
	it("emits a 200 with the body and a weak ETag on the first request", () => {
		const result = CacheableComponent(htmlComponent("<p>hi</p>"), fakeReq()).to("text/html");

		expect(result.statusCode).toBe(200);
		expect(result.body).toBe("<p>hi</p>");
		expect(result.headers.ETag).toMatch(/^W\/".+"$/);
	});

	it("returns 304 with no body when the request If-None-Match matches the freshly-computed ETag", () => {
		const body = "<p>hi</p>";
		const first = CacheableComponent(htmlComponent(body), fakeReq()).to("text/html");
		const etag = first.headers.ETag;

		const second = CacheableComponent(
			htmlComponent(body),
			fakeReq({ "if-none-match": etag }),
		).to("text/html");

		expect(second.statusCode).toBe(304);
		expect(second.body).toBe("");
		expect(second.headers.ETag).toBe(etag);
	});

	it("re-renders 200 with a fresh ETag when the body changes (the title settled, the saved-article row is no longer the hostname stub)", () => {
		const first = CacheableComponent(
			htmlComponent("<h1>medium.com</h1>"),
			fakeReq(),
		).to("text/html");
		const oldEtag = first.headers.ETag;

		const second = CacheableComponent(
			htmlComponent("<h1>Why Rust beats Go</h1>"),
			fakeReq({ "if-none-match": oldEtag }),
		).to("text/html");

		expect(second.statusCode).toBe(200);
		expect(second.body).toBe("<h1>Why Rust beats Go</h1>");
		expect(second.headers.ETag).not.toBe(oldEtag);
	});

	it("forces revalidation on every poll via Cache-Control: private, no-cache so a freshly-settled article does not wait for a TTL", () => {
		const result = CacheableComponent(htmlComponent("<p>hi</p>"), fakeReq()).to("text/html");

		expect(result.headers["Cache-Control"]).toBe("private, no-cache");
	});

	it("computes the same ETag for identical bodies across calls so the in-flight steady-state polls collapse to 304", () => {
		const first = CacheableComponent(htmlComponent("<p>same</p>"), fakeReq()).to("text/html");
		const second = CacheableComponent(htmlComponent("<p>same</p>"), fakeReq()).to("text/html");

		expect(first.headers.ETag).toBe(second.headers.ETag);
	});

	it("passes through non-HTML media types to the inner component without adding cache headers", () => {
		const result = CacheableComponent(htmlComponent("<p>hi</p>"), fakeReq()).to("text/markdown");

		expect(result.statusCode).toBe(406);
		expect(result.headers.ETag).toBeUndefined();
		expect(result.headers["Cache-Control"]).toBeUndefined();
	});
});

describe("FreshForComponent", () => {
	it("computes the same ETag for two renders that differ only in the CSP nonce", () => {
		const nonceA = generateCspNonce();
		const nonceB = generateCspNonce();
		const first = FreshForComponent(htmlWithNonce(nonceA), {
			ifNoneMatch: undefined,
			cspNonce: nonceA,
			cacheControl: MAX_AGE_5,
		}).to("text/html");
		const second = FreshForComponent(htmlWithNonce(nonceB), {
			ifNoneMatch: undefined,
			cspNonce: nonceB,
			cacheControl: MAX_AGE_5,
		}).to("text/html");

		expect(nonceA).not.toBe(nonceB);
		expect(first.headers.ETag).toBe(second.headers.ETag);
	});

	it("computes a different ETag once the body changes, so a settled listing stops matching", () => {
		const nonce = generateCspNonce();
		const twoRows = FreshForComponent(htmlWithNonce(nonce, "two rows"), {
			ifNoneMatch: undefined,
			cspNonce: nonce,
			cacheControl: MAX_AGE_5,
		}).to("text/html");
		const oneRow = FreshForComponent(htmlWithNonce(nonce, "one row"), {
			ifNoneMatch: undefined,
			cspNonce: nonce,
			cacheControl: MAX_AGE_5,
		}).to("text/html");

		expect(twoRows.headers.ETag).not.toBe(oneRow.headers.ETag);
	});

	it("passes the Cache-Control through and keeps the inner status and body on a fresh render", () => {
		const nonce = generateCspNonce();
		const result = FreshForComponent(htmlWithNonce(nonce), {
			ifNoneMatch: undefined,
			cspNonce: nonce,
			cacheControl: MAX_AGE_5,
		}).to("text/html");

		expect(result.statusCode).toBe(200);
		expect(result.headers["Cache-Control"]).toBe(MAX_AGE_5);
		expect(result.body).toContain("<main>row</main>");
		expect(result.headers.ETag).toMatch(/^W\/".+"$/);
	});

	it("answers a matching If-None-Match with 304, an empty body, and the same headers, even inside a comma list", () => {
		const nonce = generateCspNonce();
		const fresh = FreshForComponent(htmlWithNonce(nonce), {
			ifNoneMatch: undefined,
			cspNonce: nonce,
			cacheControl: MAX_AGE_5,
		}).to("text/html");
		const etag = fresh.headers.ETag;

		const laterNonce = generateCspNonce();
		const revalidated = FreshForComponent(htmlWithNonce(laterNonce), {
			ifNoneMatch: `W/"stale", ${etag}`,
			cspNonce: laterNonce,
			cacheControl: MAX_AGE_5,
		}).to("text/html");

		expect(revalidated.statusCode).toBe(304);
		expect(revalidated.body).toBe("");
		expect(revalidated.headers.ETag).toBe(etag);
		expect(revalidated.headers["Cache-Control"]).toBe(MAX_AGE_5);
	});

	it("passes a non-HTML representation through untouched, with no cache headers", () => {
		const nonce = generateCspNonce();
		const result = FreshForComponent(htmlWithNonce(nonce), {
			ifNoneMatch: undefined,
			cspNonce: nonce,
			cacheControl: MAX_AGE_5,
		}).to("text/markdown");

		expect(result.statusCode).toBe(406);
		expect(result.headers.ETag).toBeUndefined();
		expect(result.headers["Cache-Control"]).toBeUndefined();
	});
});
