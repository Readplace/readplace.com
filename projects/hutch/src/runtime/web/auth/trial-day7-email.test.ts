import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ReaderArticleHashId } from "@packages/domain/article";
import { EMAIL_POSTAL_ADDRESS } from "../email-copy";
import { RENEWAL_PRICES } from "../price-statement";
import { KEEP_READPLACE_LABEL, UNSUBSCRIBE_LABEL } from "../queue-digest-email";
import { buildOwnerReaderPath } from "../pages/readlist/owner-reader-link";
import { TrialDay7Email } from "./trial-day7-email";

const APP_ORIGIN = "https://readplace.com";
const TRACKING = "utm_source=day7-email&utm_medium=email&utm_campaign=trial-keep";
const TOKEN = "user.signature";
const FIRST_ID = ReaderArticleHashId.from("https://example.com/first");

function build(overrides: Partial<Parameters<typeof TrialDay7Email>[0]> = {}) {
	return TrialDay7Email({
		items: [{ articleId: FIRST_ID, title: "First & best", siteName: "example.com" }],
		savedCount: 4,
		readCount: 2,
		registeredAt: "2026-11-06T00:00:00.000Z",
		trialEndsAt: "2026-11-20T00:00:00.000Z",
		appOrigin: APP_ORIGIN,
		unsubscribeToken: TOKEN,
		...overrides,
	});
}

function bodyOf(html: string) {
	const { document } = new JSDOM(html).window;
	const text = document.body.textContent;
	assert(text !== null);
	return { document, text: text.replace(/\s+/g, " ").trim() };
}

const ARTICLE_URL = `${APP_ORIGIN}${buildOwnerReaderPath(FIRST_ID)}&${TRACKING}&utm_content=article`;
const READLIST_URL = `${APP_ORIGIN}/queue?${TRACKING}&utm_content=readlist`;
const KEEP_URL = `${APP_ORIGIN}/account/plans?${TRACKING}&utm_content=keep`;
const UNSUBSCRIBE_URL = `${APP_ORIGIN}/email/queue-digest/unsubscribe?t=${encodeURIComponent(TOKEN)}&kind=trial-day7`;
const PRICE_PARAGRAPH = `Your trial ends on Nov 20, 2026. Choose during your trial: ${RENEWAL_PRICES} Add a card now and nothing is charged until Nov 20, 2026; you'll get a reminder before the charge. Your saves stay readable and exportable either way.`;
const SIGNOFF = "— Fayner Brack, Founder & CEO";

describe("TrialDay7Email", () => {
	it("renders the whole copy as plain text", () => {
		const email = build();

		assert.equal(email.subject, "Your readlist, a week in");
		assert.equal(
			email.to("text/plain"),
			[
				"Your readlist, a week in",
				"In your first week you saved 4 articles and read 2.",
				"Still waiting for you:",
				`- First & best — example.com\n${ARTICLE_URL}`,
				`Continue reading: ${READLIST_URL}`,
				PRICE_PARAGRAPH,
				`${KEEP_READPLACE_LABEL}: ${KEEP_URL}`,
				SIGNOFF,
				`You're getting this because you started a Readplace trial on Nov 6, 2026. ${UNSUBSCRIBE_LABEL}: ${UNSUBSCRIBE_URL}&${TRACKING}&utm_content=unsubscribe · Proficient Pty Ltd, ${EMAIL_POSTAL_ADDRESS}`,
			].join("\n\n"),
		);
	});

	it("drops the read clause when nothing was read", () => {
		const email = build({ readCount: 0 });

		assert.ok(email.to("text/plain").includes("In your first week you saved 4 articles.\n\n"));
		assert.ok(bodyOf(email.to("text/html")).text.includes("In your first week you saved 4 articles. Still waiting"));
	});

	it("pluralises the saved count from the count", () => {
		const email = build({ savedCount: 1, readCount: 0 });

		assert.ok(email.to("text/plain").includes("In your first week you saved 1 article.\n\n"));
	});

	it("mirrors the plain text in the HTML body", () => {
		const { text, document } = bodyOf(build().to("text/html"));

		assert.equal(
			text,
			[
				"Your readlist, a week in",
				"In your first week you saved 4 articles and read 2.",
				"Still waiting for you:",
				"First & best — example.com",
				"Continue reading",
				PRICE_PARAGRAPH,
				KEEP_READPLACE_LABEL,
				SIGNOFF,
				`You're getting this because you started a Readplace trial on Nov 6, 2026. ${UNSUBSCRIBE_LABEL} · Proficient Pty Ltd, ${EMAIL_POSTAL_ADDRESS}`,
			].join(" "),
		);
		assert.equal(document.title, "Your readlist, a week in");
	});

	it("links the list item, the buttons and the footer to their tracked destinations", () => {
		const { document } = bodyOf(build().to("text/html"));

		const hrefs = Array.from(document.querySelectorAll("a"), (anchor) => anchor.getAttribute("href"));
		assert.deepEqual(hrefs, [
			ARTICLE_URL,
			READLIST_URL,
			KEEP_URL,
			`${UNSUBSCRIBE_URL}&${TRACKING}&utm_content=unsubscribe`,
		]);
	});

	it("carries the one-click unsubscribe headers on the untracked link", () => {
		assert.deepEqual(build().headers, {
			"List-Unsubscribe": `<${UNSUBSCRIBE_URL}>`,
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		});
	});
});
