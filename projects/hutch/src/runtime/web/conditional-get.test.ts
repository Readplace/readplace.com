import type { ConditionalGetRequest } from "./conditional-get";
import { CacheableComponent } from "./conditional-get";
import { HtmlPage } from "./html-page";
import type { Component } from "./component.types";

function fakeReq(headers: Record<string, string> = {}): ConditionalGetRequest {
	return { headers };
}

function htmlComponent(body: string): Component {
	return HtmlPage(body);
}

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
