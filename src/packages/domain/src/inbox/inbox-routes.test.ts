import assert from "node:assert/strict";
import {
	INBOX_PATH,
	buildCustomEmailsUrl,
	buildInboxHighlightUrl,
	inboxEmailPath,
	parseCustomEmailsOrigin,
	parseInboxHighlight,
} from "./inbox-routes";

describe("inbox routes", () => {
	it("keeps an email's id to one path segment of its inbox page", () => {
		assert.equal(
			inboxEmailPath("2026-06-24T09:00:00.000Z#<m@x>"),
			"/inbox/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E",
		);
	});

	it("builds a highlight link that survives an id carrying URL-significant characters", () => {
		const url = buildInboxHighlightUrl({
			receivedAtMessageId: "2026-06-24T09:00:00.000Z#<m@x>",
		});

		assert.equal(
			url,
			`${INBOX_PATH}?highlight=2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E`,
		);
		assert.equal(
			parseInboxHighlight(Object.fromEntries(new URL(url, "https://x.test").searchParams)),
			"2026-06-24T09:00:00.000Z#<m@x>",
		);
	});

	it("falls back to the plain list when no email is named", () => {
		assert.equal(buildInboxHighlightUrl({}), INBOX_PATH);
	});

	it("reads no highlight from a query that omits it or leaves it blank", () => {
		assert.equal(parseInboxHighlight({}), undefined);
		assert.equal(parseInboxHighlight({ highlight: "" }), undefined);
		assert.equal(parseInboxHighlight({ highlight: ["a", "b"] }), undefined);
	});

	it("reads the custom emails origin as Newsletters only when the query names it", () => {
		assert.equal(parseCustomEmailsOrigin({ from: "newsletters" }), "newsletters");
		assert.equal(parseCustomEmailsOrigin({}), "inbox");
		assert.equal(parseCustomEmailsOrigin({ from: "elsewhere" }), "inbox");
	});

	it("carries a Newsletters origin on every custom emails URL so the back link survives a redirect", () => {
		assert.equal(
			buildCustomEmailsUrl({ origin: "newsletters", subpath: "", params: { created: "news" } }),
			"/newsletters/custom-emails?created=news&from=newsletters",
		);
		assert.equal(
			buildCustomEmailsUrl({ origin: "newsletters", subpath: "/create", params: {} }),
			"/newsletters/custom-emails/create?from=newsletters",
		);
	});

	it("leaves the custom emails URL bare for an Inbox origin with no params", () => {
		assert.equal(buildCustomEmailsUrl({ origin: "inbox", subpath: "", params: {} }), "/newsletters/custom-emails");
		assert.equal(
			buildCustomEmailsUrl({ origin: "inbox", subpath: "", params: { error: "limit", name: "news" } }),
			"/newsletters/custom-emails?error=limit&name=news",
		);
	});
});
