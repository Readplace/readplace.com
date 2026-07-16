import { isListUnsubscribeTarget, parseListUnsubscribeHeader } from "./list-unsubscribe";

describe("parseListUnsubscribeHeader", () => {
	it("keeps the http(s) targets and drops the mailto one", () => {
		expect(
			parseListUnsubscribeHeader(
				"<mailto:unsub@news.example.com>, <https://news.example.com/unsub?u=1&id=2>",
			),
		).toEqual(["https://news.example.com/unsub?u=1&id=2"]);
	});

	it("keeps a plain http target", () => {
		expect(parseListUnsubscribeHeader("<http://news.example.com/unsub>")).toEqual([
			"http://news.example.com/unsub",
		]);
	});

	it("strips folded-header whitespace inside a target", () => {
		expect(parseListUnsubscribeHeader("<https://news.example.com/uns ub?x=1>")).toEqual([
			"https://news.example.com/unsub?x=1",
		]);
	});

	it("returns nothing for a value without angle-bracketed targets", () => {
		expect(parseListUnsubscribeHeader("https://bare.example.com/unsub")).toEqual([]);
	});

	it("drops a bracketed target that is not a URL", () => {
		expect(parseListUnsubscribeHeader("<not a url>")).toEqual([]);
	});
});

describe("isListUnsubscribeTarget", () => {
	const endpointTarget = ["https://news.example.com/unsub"];

	it("matches the identical URL", () => {
		expect(
			isListUnsubscribeTarget({
				url: "https://news.example.com/unsub",
				listUnsubscribeUrls: endpointTarget,
			}),
		).toBe(true);
	});

	it("matches the endpoint carrying a per-send token the target does not name", () => {
		expect(
			isListUnsubscribeTarget({
				url: "https://news.example.com/unsub?token=send-2&extra=1",
				listUnsubscribeUrls: endpointTarget,
			}),
		).toBe(true);
	});

	it("matches across a trailing-slash difference", () => {
		expect(
			isListUnsubscribeTarget({
				url: "https://news.example.com/unsub/",
				listUnsubscribeUrls: endpointTarget,
			}),
		).toBe(true);
	});

	it("matches across an http/https scheme difference", () => {
		expect(
			isListUnsubscribeTarget({
				url: "http://news.example.com/unsub",
				listUnsubscribeUrls: endpointTarget,
			}),
		).toBe(true);
	});

	it("matches across a path-case difference", () => {
		expect(
			isListUnsubscribeTarget({
				url: "https://news.example.com/UnSub",
				listUnsubscribeUrls: endpointTarget,
			}),
		).toBe(true);
	});

	it("matches across an explicit-port difference", () => {
		expect(
			isListUnsubscribeTarget({
				url: "https://news.example.com:8443/unsub",
				listUnsubscribeUrls: endpointTarget,
			}),
		).toBe(true);
	});

	it("does not match a different path on the unsubscribe host", () => {
		expect(
			isListUnsubscribeTarget({
				url: "https://news.example.com/articles/weekly",
				listUnsubscribeUrls: endpointTarget,
			}),
		).toBe(false);
	});

	it("does not match the unsubscribe path on a different host", () => {
		expect(
			isListUnsubscribeTarget({
				url: "https://other.example.com/unsub",
				listUnsubscribeUrls: endpointTarget,
			}),
		).toBe(false);
	});

	const wrappedTarget = ["https://ct.example.com/ls/click?upn=unsub-token"];

	it("matches a wrapped target when the candidate carries the same wrapper params plus extras", () => {
		expect(
			isListUnsubscribeTarget({
				url: "https://ct.example.com/ls/click?upn=unsub-token&utm_source=email",
				listUnsubscribeUrls: wrappedTarget,
			}),
		).toBe(true);
	});

	it("does not match a different link wrapped through the same click-tracker path", () => {
		expect(
			isListUnsubscribeTarget({
				url: "https://ct.example.com/ls/click?upn=article-token",
				listUnsubscribeUrls: wrappedTarget,
			}),
		).toBe(false);
	});

	it("never matches a bare site-root target", () => {
		expect(
			isListUnsubscribeTarget({
				url: "https://example.com",
				listUnsubscribeUrls: ["https://example.com/"],
			}),
		).toBe(false);
	});

	it("matches a site-root target that identifies itself by query", () => {
		expect(
			isListUnsubscribeTarget({
				url: "https://example.com/?unsubscribe=1&utm_source=email",
				listUnsubscribeUrls: ["https://example.com/?unsubscribe=1"],
			}),
		).toBe(true);
	});

	it("does not match when the candidate is not a URL", () => {
		expect(
			isListUnsubscribeTarget({ url: "not a url", listUnsubscribeUrls: endpointTarget }),
		).toBe(false);
	});

	it("ignores a list entry that is not a URL", () => {
		expect(
			isListUnsubscribeTarget({
				url: "https://news.example.com/unsub",
				listUnsubscribeUrls: ["not a url"],
			}),
		).toBe(false);
	});

	it("never matches against an empty target list", () => {
		expect(
			isListUnsubscribeTarget({ url: "https://news.example.com/unsub", listUnsubscribeUrls: [] }),
		).toBe(false);
	});
});
