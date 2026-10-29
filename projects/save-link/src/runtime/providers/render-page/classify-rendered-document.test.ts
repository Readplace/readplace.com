import { classifyRenderedDocument } from "./classify-rendered-document";

const FINAL_URL = "https://example-spa.test/post";
const RENDERED_HTML = "<html><head><title>Post</title></head><body><article><p>Rendered body</p></article></body></html>";
const FASTLY_CHALLENGE_HTML =
	'<html><head><title>Client Challenge</title></head><body><script src="/_fs-ch-abc/script.js"></script></body></html>';

describe("classifyRenderedDocument", () => {
	it("serves a 2xx document as rendered", () => {
		expect(
			classifyRenderedDocument({ httpStatus: 200, headers: { "content-type": "text/html" }, html: RENDERED_HTML, finalUrl: FINAL_URL }),
		).toEqual({ kind: "rendered", html: RENDERED_HTML, finalUrl: FINAL_URL, httpStatus: 200 });
	});

	it("serves a 2xx document whose repeated headers arrive joined by newlines", () => {
		const twoCookies = { "content-type": "text/html", "set-cookie": "_csrf=abc; Path=/; HttpOnly\nlocale=en; Path=/" };
		expect(classifyRenderedDocument({ httpStatus: 200, headers: twoCookies, html: RENDERED_HTML, finalUrl: FINAL_URL })).toEqual({
			kind: "rendered",
			html: RENDERED_HTML,
			finalUrl: FINAL_URL,
			httpStatus: 200,
		});
	});

	it("treats an AWS WAF challenge as blocked when it arrives beside repeated headers", () => {
		const challenge = { "x-amzn-waf-action": "challenge", "set-cookie": "a=1\nb=2" };
		expect(classifyRenderedDocument({ httpStatus: 202, headers: challenge, html: "<html></html>", finalUrl: FINAL_URL })).toEqual({
			kind: "blocked",
			httpStatus: 202,
		});
	});

	it("treats a block-class status as blocked", () => {
		expect(classifyRenderedDocument({ httpStatus: 403, headers: {}, html: RENDERED_HTML, finalUrl: FINAL_URL })).toEqual({
			kind: "blocked",
			httpStatus: 403,
		});
	});

	it("treats a rate-limited document as blocked", () => {
		expect(classifyRenderedDocument({ httpStatus: 429, headers: {}, html: RENDERED_HTML, finalUrl: FINAL_URL })).toEqual({
			kind: "blocked",
			httpStatus: 429,
		});
	});

	it("treats an AWS WAF challenge as blocked even when it answers 202", () => {
		expect(
			classifyRenderedDocument({ httpStatus: 202, headers: { "x-amzn-waf-action": "challenge" }, html: "<html></html>", finalUrl: FINAL_URL }),
		).toEqual({ kind: "blocked", httpStatus: 202 });
	});

	it("treats a Fastly client challenge left in the rendered DOM as blocked", () => {
		expect(
			classifyRenderedDocument({ httpStatus: 200, headers: { "content-type": "text/html" }, html: FASTLY_CHALLENGE_HTML, finalUrl: FINAL_URL }),
		).toEqual({ kind: "blocked", httpStatus: 200 });
	});

	it("fails a document that answered a server error", () => {
		expect(classifyRenderedDocument({ httpStatus: 500, headers: {}, html: RENDERED_HTML, finalUrl: FINAL_URL })).toEqual({
			kind: "failed",
			detail: "main document answered HTTP 500",
			httpStatus: 500,
		});
	});

	it("fails a document that answered not found", () => {
		expect(classifyRenderedDocument({ httpStatus: 404, headers: {}, html: RENDERED_HTML, finalUrl: FINAL_URL })).toEqual({
			kind: "failed",
			detail: "main document answered HTTP 404",
			httpStatus: 404,
		});
	});

	it("fails a document whose status is below the success range", () => {
		expect(classifyRenderedDocument({ httpStatus: 0, headers: {}, html: RENDERED_HTML, finalUrl: FINAL_URL })).toEqual({
			kind: "failed",
			detail: "main document answered HTTP 0",
			httpStatus: 0,
		});
	});
});
