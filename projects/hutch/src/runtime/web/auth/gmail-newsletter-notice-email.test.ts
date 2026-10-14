import { JSDOM } from "jsdom";
import { GmailNewsletterNoticeEmail, type GmailNewsletterNoticeItem } from "./gmail-newsletter-notice-email";

const GMAIL_URL = "https://readplace.com/newsletters/gmail?utm_content=choose-readlists";
const REPLY = "If you have any questions, please reply to this email";
const SIGNOFF = "— Fayner Brack, Founder & CEO";
const IMPORT_SENTENCE = "You can also choose to import earlier unread messages from the last 30 days.";

const newsletter = (overrides: Partial<GmailNewsletterNoticeItem> = {}): GmailNewsletterNoticeItem => ({
	newsletterName: "Example Letter",
	senderEmail: "letter@example.com",
	choiceUrl: "https://readplace.com/newsletters/gmail?sender=letter%40example.com",
	...overrides,
});
const notice = (newsletters: GmailNewsletterNoticeItem[], waiting = 0) =>
	GmailNewsletterNoticeEmail({ founderAvatarUrl: "https://static.readplace.com/fayner-brack.jpg", newsletters, gmailUrl: GMAIL_URL, waiting });
const footerOf = (html: string) => {
	const paragraphs = [...new JSDOM(html).window.document.querySelectorAll("p")];
	return paragraphs[paragraphs.length - 1]?.textContent;
};

describe("GmailNewsletterNoticeEmail", () => {
	it("names one newsletter, links straight to its readlist choice, and says why the reader got a one-time notice", () => {
		const email = notice([newsletter()]);

		expect(email.subject).toBe("Choose readlists for Example Letter");
		expect(email.to("text/plain")).toBe([
			"Readplace recognizes Example Letter in your Gmail: letter@example.com. It is ready to connect to your readlists.",
			`Choose readlists and Save to send its future emails to Readplace. What you choose to save — the issue itself, the articles it links to, or both — goes to All and any readlists you pick. ${IMPORT_SENTENCE}`,
			"Choose readlists: https://readplace.com/newsletters/gmail?sender=letter%40example.com",
			REPLY,
			SIGNOFF,
			"You are receiving this email because you haven't chosen readlists for this newsletter. This is a one-time notification for Example Letter.",
		].join("\n\n"));
		expect(footerOf(email.to("text/html"))).toBe("You are receiving this email because you haven't chosen readlists for this newsletter. This is a one-time notification for Example Letter.");
	});

	it("names an unnamed newsletter by its address", () => {
		const email = notice([newsletter({ newsletterName: undefined })]);

		expect(email.subject).toBe("Choose readlists for letter@example.com");
		expect(footerOf(email.to("text/html"))).toBe("You are receiving this email because you haven't chosen readlists for this newsletter. This is a one-time notification for letter@example.com.");
	});

	it("lists several newsletters, each linked to its own readlist choice, points the button at the Gmail page, and says nothing about waiting newsletters when none wait", () => {
		const email = notice([
			newsletter(),
			newsletter({ newsletterName: undefined, senderEmail: "news@wildcard.example", choiceUrl: "https://readplace.com/newsletters/gmail?sender=news%40wildcard.example" }),
		]);

		expect(email.subject).toBe("Choose readlists for 2 newsletters");
		expect(email.to("text/plain")).toBe([
			"Readplace recognizes 2 newsletters in your Gmail that are ready to connect to your readlists:",
			"Example Letter (letter@example.com): https://readplace.com/newsletters/gmail?sender=letter%40example.com",
			"news@wildcard.example: https://readplace.com/newsletters/gmail?sender=news%40wildcard.example",
			`Choose readlists for a newsletter and Save to send its future emails to Readplace. What you choose to save — the issue itself, the articles it links to, or both — goes to All and any readlists you pick. ${IMPORT_SENTENCE}`,
			`Choose readlists: ${GMAIL_URL}`,
			REPLY,
			SIGNOFF,
			"You are receiving this email because you haven't chosen readlists for these newsletters. This is a one-time notification for each of them.",
		].join("\n\n"));
		const anchors = [...new JSDOM(email.to("text/html")).window.document.querySelectorAll("a")].map((anchor) => [anchor.textContent, anchor.getAttribute("href")]);
		expect(anchors).toEqual([
			["Example Letter", "https://readplace.com/newsletters/gmail?sender=letter%40example.com"],
			["letter@example.com", "https://readplace.com/newsletters/gmail?sender=letter%40example.com"],
			["news@wildcard.example", "https://readplace.com/newsletters/gmail?sender=news%40wildcard.example"],
			["Choose readlists", GMAIL_URL],
		]);
		expect(new JSDOM(email.to("text/html")).window.document.querySelector("a")?.closest("table")?.nextElementSibling?.textContent).toBe(`Choose readlists for a newsletter and Save to send its future emails to Readplace. What you choose to save — the issue itself, the articles it links to, or both — goes to All and any readlists you pick. ${IMPORT_SENTENCE}`);
	});

	it.each([
		[1, "1 more newsletter is waiting and will be in your next email in about 7 days."],
		[3, "3 more newsletters are waiting and will be in your next email in about 7 days."],
	])("says %i more newsletters wait for the next email, between the list and the paragraph", (waiting, sentence) => {
		const email = notice([
			newsletter(),
			newsletter({ newsletterName: undefined, senderEmail: "news@wildcard.example", choiceUrl: "https://readplace.com/newsletters/gmail?sender=news%40wildcard.example" }),
		], waiting);

		expect(email.to("text/plain")).toBe([
			"Readplace recognizes 2 newsletters in your Gmail that are ready to connect to your readlists:",
			"Example Letter (letter@example.com): https://readplace.com/newsletters/gmail?sender=letter%40example.com",
			"news@wildcard.example: https://readplace.com/newsletters/gmail?sender=news%40wildcard.example",
			sentence,
			`Choose readlists for a newsletter and Save to send its future emails to Readplace. What you choose to save — the issue itself, the articles it links to, or both — goes to All and any readlists you pick. ${IMPORT_SENTENCE}`,
			`Choose readlists: ${GMAIL_URL}`,
			REPLY,
			SIGNOFF,
			"You are receiving this email because you haven't chosen readlists for these newsletters. This is a one-time notification for each of them.",
		].join("\n\n"));
		const html = email.to("text/html");
		const listTable = new JSDOM(html).window.document.querySelector("a")?.closest("table");
		expect(listTable?.nextElementSibling?.tagName).toBe("P");
		expect(listTable?.nextElementSibling?.textContent).toBe(sentence);
		expect(footerOf(html)).toBe("You are receiving this email because you haven't chosen readlists for these newsletters. This is a one-time notification for each of them.");
	});

	it("refuses a single-newsletter notice that says more are waiting", () => {
		expect(() => notice([newsletter()], 1)).toThrow("A single-newsletter Gmail notice never leaves newsletters waiting");
	});

	it("refuses to build a notice without a newsletter", () => {
		expect(() => notice([])).toThrow("A Gmail newsletter notice lists at least one newsletter");
	});
});
