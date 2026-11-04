import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ReaderArticleHashId } from "@packages/domain/article";
import { EMAIL_POSTAL_ADDRESS } from "../email-copy";
import { RENEWAL_PRICES } from "../price-statement";
import { KEEP_READPLACE_LABEL, UNSUBSCRIBE_LABEL } from "../queue-digest-email";
import { TrialDay3Email } from "./trial-day3-email";

const APP_ORIGIN = "https://readplace.com";
const TRACKING = "utm_source=day3-email&utm_medium=email&utm_campaign=trial-keep";
const TOKEN = "user.signature";
const FIRST_ID = ReaderArticleHashId.from("https://example.com/first");
const SECOND_ID = ReaderArticleHashId.from("https://example.com/second");

function articleHref(id: typeof FIRST_ID): string {
	return `${APP_ORIGIN}/queue/${id.value}/view?from=day3-email&${TRACKING}&utm_content=article`;
}

const FIRST = { articleId: FIRST_ID, title: "First & best", siteName: "example.com" };
const SECOND = { articleId: SECOND_ID, title: "Second", siteName: "other.example" };

function build(overrides: Partial<Parameters<typeof TrialDay3Email>[0]> = {}) {
	return TrialDay3Email({
		items: [FIRST, SECOND],
		savedCount: 2,
		registeredAt: "2026-11-06T00:00:00.000Z",
		trialEndsAt: "2026-11-20T00:00:00.000Z",
		install: "extension",
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

const UNSUBSCRIBE_URL = `${APP_ORIGIN}/email/queue-digest/unsubscribe?t=${encodeURIComponent(TOKEN)}&kind=trial-day3`;
const PRICE_PARAGRAPH = `Choose during your trial: ${RENEWAL_PRICES} Add a card now and nothing is charged until Nov 20, 2026; you'll get an email a week before. Your saves stay readable and exportable either way.`;
const KEEP_LINE = `${KEEP_READPLACE_LABEL}: ${APP_ORIGIN}/account/plans?${TRACKING}&utm_content=keep`;
const REPLY_LINE = "If something didn't save the way you expected, reply to this email — it comes straight to me.";
const SIGNOFF = "— Fayner Brack, Founder & CEO";
const FOOTER_LINE = `You're getting this because you started a Readplace trial on Nov 6, 2026. ${UNSUBSCRIBE_LABEL}: ${UNSUBSCRIBE_URL}&${TRACKING}&utm_content=unsubscribe · Proficient Pty Ltd, ${EMAIL_POSTAL_ADDRESS}`;
const EXTENSION_PARAGRAPH = "On your computer, the browser extension saves the page you're on in one click, so the next one doesn't wait for you to come back here.";
const IPHONE_PARAGRAPH = "On your iPhone, the Readplace app adds Readplace to the share sheet, so an article in Safari, Mail or a newsletter app is one tap from your readlist.";

describe("TrialDay3Email", () => {
	it("renders the whole plural copy as plain text, with the extension link", () => {
		const email = build();

		assert.equal(email.subject, "the 2 articles you've saved in Readplace");
		assert.equal(
			email.to("text/plain"),
			[
				"Your first 2 saves",
				"You've saved 2 articles since Nov 6, 2026. Here they are:",
				`- First & best — example.com\n${articleHref(FIRST_ID)}`,
				`- Second — other.example\n${articleHref(SECOND_ID)}`,
				EXTENSION_PARAGRAPH,
				`Add the extension: ${APP_ORIGIN}/install?${TRACKING}&utm_content=install-extension`,
				PRICE_PARAGRAPH,
				KEEP_LINE,
				REPLY_LINE,
				SIGNOFF,
				FOOTER_LINE,
			].join("\n\n"),
		);
	});

	it("renders the singular copy with no install paragraph as plain text", () => {
		const email = build({ items: [FIRST], savedCount: 1, install: undefined });

		assert.equal(email.subject, "the article you saved in Readplace");
		assert.equal(
			email.to("text/plain"),
			[
				"Your first save",
				"You've saved 1 article since Nov 6, 2026. Here it is:",
				`- First & best — example.com\n${articleHref(FIRST_ID)}`,
				PRICE_PARAGRAPH,
				KEEP_LINE,
				REPLY_LINE,
				SIGNOFF,
				FOOTER_LINE,
			].join("\n\n"),
		);
	});

	it("says how many more wait when the list is shorter than the count", () => {
		const email = build({ savedCount: 7, install: undefined });

		const text = email.to("text/plain");
		assert.ok(text.includes(`${articleHref(SECOND_ID)}\n\nand 5 more in your readlist.\n\n${PRICE_PARAGRAPH}`));
		assert.ok(bodyOf(email.to("text/html")).text.includes("and 5 more in your readlist."));
	});

	it("leaves the more-in-your-readlist line out when every save is listed", () => {
		const email = build();

		assert.ok(!email.to("text/plain").includes("more in your readlist"));
		assert.ok(!bodyOf(email.to("text/html")).text.includes("more in your readlist"));
	});

	it("mirrors the plain text in the HTML body", () => {
		const { text, document } = bodyOf(build({ savedCount: 2 }).to("text/html"));

		assert.equal(
			text,
			[
				"Your first 2 saves",
				"You've saved 2 articles since Nov 6, 2026. Here they are:",
				"First & best — example.com",
				"Second — other.example",
				EXTENSION_PARAGRAPH,
				"Add the extension",
				PRICE_PARAGRAPH,
				KEEP_READPLACE_LABEL,
				REPLY_LINE,
				SIGNOFF,
				`You're getting this because you started a Readplace trial on Nov 6, 2026. ${UNSUBSCRIBE_LABEL} · Proficient Pty Ltd, ${EMAIL_POSTAL_ADDRESS}`,
			].join(" "),
		);
		assert.equal(document.title, "the 2 articles you've saved in Readplace");
	});

	it("links each list item to its reader path and each button to its tracked destination", () => {
		const { document } = bodyOf(build().to("text/html"));

		const hrefs = Array.from(document.querySelectorAll("a"), (anchor) => anchor.getAttribute("href"));
		assert.deepEqual(hrefs, [
			articleHref(FIRST_ID),
			articleHref(SECOND_ID),
			`${APP_ORIGIN}/install?${TRACKING}&utm_content=install-extension`,
			`${APP_ORIGIN}/account/plans?${TRACKING}&utm_content=keep`,
			`${UNSUBSCRIBE_URL}&${TRACKING}&utm_content=unsubscribe`,
		]);
	});

	it("names the iPhone app and links the iPhone install page by its client", () => {
		const email = build({ install: "iphone" });

		const text = email.to("text/plain");
		assert.ok(text.includes(IPHONE_PARAGRAPH));
		assert.ok(text.includes(`Get the iPhone app: ${APP_ORIGIN}/install?client=iphone&${TRACKING}&utm_content=install-iphone`));
		assert.ok(!text.includes(EXTENSION_PARAGRAPH));
		const { text: htmlText } = bodyOf(email.to("text/html"));
		assert.ok(htmlText.includes(IPHONE_PARAGRAPH));
		assert.ok(htmlText.includes("Get the iPhone app"));
	});

	it("carries the one-click unsubscribe headers on the untracked link", () => {
		assert.deepEqual(build().headers, {
			"List-Unsubscribe": `<${UNSUBSCRIBE_URL}>`,
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		});
	});

	it("escapes a saved article's title in the HTML", () => {
		const html = build({
			items: [{ ...FIRST, title: "<img src=x onerror=alert(1)>" }],
			savedCount: 1,
		}).to("text/html");

		assert.equal(bodyOf(html).document.querySelectorAll("img").length, 0);
	});
});
