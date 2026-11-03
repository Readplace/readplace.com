import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { EMAIL_POSTAL_ADDRESS } from "../email-copy";
import { PRICE_STATEMENT, SAVES_STAY_STATEMENT } from "../price-statement";
import { UNSUBSCRIBE_LABEL } from "../queue-digest-email";
import { buildWelcomeConnectorEmailHtml, buildWelcomeEmailHtml } from "./welcome-email";

describe("buildWelcomeEmailHtml", () => {
	it("includes the install URL in the call-to-action link", () => {
		const html = buildWelcomeEmailHtml({ installUrl: "https://readplace.com/install", avatarUrl: "https://static.readplace.com/fayner-brack.jpg" });

		expect(html).toContain('href="https://readplace.com/install"');
	});

	it("escapes HTML entities in the install URL to prevent injection", () => {
		const html = buildWelcomeEmailHtml({
			installUrl: 'https://example.com/install?a=1&b=2"<>',
			avatarUrl: "https://static.readplace.com/fayner-brack.jpg",
		});

		expect(html).toContain('href="https://example.com/install?a&#x3D;1&amp;b&#x3D;2&quot;&lt;&gt;"');
	});

	it("renders the avatar image at the top of the body", () => {
		const html = buildWelcomeEmailHtml({
			installUrl: "https://readplace.com/install",
			avatarUrl: "https://static.readplace.com/fayner-brack.jpg",
		});

		expect(html).toContain('src="https://static.readplace.com/fayner-brack.jpg"');
		expect(html).toContain('alt="Fayner Brack"');
	});

	it("escapes HTML entities in the avatar URL to prevent injection", () => {
		const html = buildWelcomeEmailHtml({
			installUrl: "https://readplace.com/install",
			avatarUrl: 'https://example.com/avatar.jpg?a=1&b=2"<>',
		});

		expect(html).toContain('src="https://example.com/avatar.jpg?a&#x3D;1&amp;b&#x3D;2&quot;&lt;&gt;"');
	});

	it("renders the welcome heading", () => {
		const html = buildWelcomeEmailHtml({ installUrl: "https://readplace.com/install", avatarUrl: "https://static.readplace.com/fayner-brack.jpg" });

		expect(html).toContain("Welcome to Readplace");
	});

	it("pitches saving from every client, not just the browser extension", () => {
		const html = buildWelcomeEmailHtml({ installUrl: "https://readplace.com/install", avatarUrl: "https://static.readplace.com/fayner-brack.jpg" });

		expect(html).toContain("your browser, your phone, or your AI assistant");
		expect(html).toContain("See the ways to save");
	});

	it("invites the recipient to reply directly with feedback", () => {
		const html = buildWelcomeEmailHtml({ installUrl: "https://readplace.com/install", avatarUrl: "https://static.readplace.com/fayner-brack.jpg" });

		expect(html).toContain("reply to this email");
	});

	it("produces a complete HTML document", () => {
		const html = buildWelcomeEmailHtml({ installUrl: "https://readplace.com/install", avatarUrl: "https://static.readplace.com/fayner-brack.jpg" });

		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("</html>");
	});

	it("stays byte-identical to the welcome sent before the connector variant", () => {
		const html = buildWelcomeEmailHtml({ installUrl: "https://readplace.com/install", avatarUrl: "https://static.readplace.com/fayner-brack.jpg" });

		expect(createHash("sha256").update(html).digest("hex")).toBe("4e2101658fe6e4099649611cc3d5aa25c9a2970c3f2be972c339ba4168b1edd7");
	});
});

describe("buildWelcomeConnectorEmailHtml", () => {
	const UNSUBSCRIBE_URL = "https://readplace.com/email/queue-digest/unsubscribe?t=token";

	function build(assistantName: "ChatGPT" | "Claude"): string {
		return buildWelcomeConnectorEmailHtml({
			assistantName,
			installUrl: "https://readplace.com/install",
			avatarUrl: "https://static.readplace.com/fayner-brack.jpg",
			unsubscribeUrl: UNSUBSCRIBE_URL,
		});
	}

	function bodyText(html: string): string {
		const text = new JSDOM(html).window.document.body.textContent;
		assert(text, "the email must have body text");
		return text.replace(/\s+/g, " ").trim();
	}

	it.each(["ChatGPT", "Claude"] as const)("renders the whole %s body and nothing else", (assistantName) => {
		expect(bodyText(build(assistantName))).toBe(
			[
				"Welcome to Readplace",
				`Thanks for connecting Readplace to ${assistantName} — really glad you're here.`,
				`When you ask ${assistantName} to save a page, Readplace keeps a clean copy of the article in your readlist. You can ask ${assistantName} what's waiting there, and the original sources are still in Readplace after the conversation ends.`,
				"Most of what's worth keeping turns up outside a chat. On your computer, the browser extension saves the page you're on in one click. On your iPhone, the Readplace app adds Readplace to the share sheet.",
				"See the ways to save",
				`${PRICE_STATEMENT} ${SAVES_STAY_STATEMENT}`,
				"If anything breaks or feels off, just reply to this email — it comes straight to me, and I read everything.",
				"— Fayner Brack, Founder & CEO",
				`You're getting this because you created a Readplace account from ${assistantName}. ${UNSUBSCRIBE_LABEL} · Proficient Pty Ltd, ${EMAIL_POSTAL_ADDRESS}`,
			].join(" "),
		);
	});

	it("links the call to action, the avatar and the unsubscribe line", () => {
		const document = new JSDOM(build("Claude")).window.document;
		const hrefs = [...document.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]);

		expect(hrefs).toEqual([
			["See the ways to save", "https://readplace.com/install"],
			[UNSUBSCRIBE_LABEL, UNSUBSCRIBE_URL],
		]);
		expect(document.querySelector("img")?.getAttribute("src")).toBe("https://static.readplace.com/fayner-brack.jpg");
	});
});
