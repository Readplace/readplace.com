import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import { QueueDigestEmail, type QueueDigestEmailItem } from "./queue-digest-email";

const ORIGIN = "https://readplace.com";
const SEND_ID = "3f1d2c4b-8a7e-4c61-9b0d-5e2f6a7c8d90";
const UNSUBSCRIBE_TOKEN = "user-7.5d41402abc4b2a76b9719d911017c592";
const LINKS = { appOrigin: ORIGIN, sendId: SEND_ID, unsubscribeToken: UNSUBSCRIBE_TOKEN };
const ARTICLE_ID = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const SECOND_ARTICLE_ID = ReaderArticleHashIdSchema.parse("fedcba9876543210fedcba9876543210");
const TRIAL_ENDS_AT = "2026-10-05T03:00:00.000Z";
const PAY_TERMS =
	"Choose a plan before Oct 3, 2026, 02:55 UTC and nothing is charged until Oct 5, 2026. After that, choosing a plan starts it the same day.";
const POSTAL_ADDRESS = "Suite 349/585 Little Collins St, Melbourne VIC 3000";
const REGULAR_FOOTER_REASON =
	"You're getting this because Readplace sends a one-time reminder for articles that stay unread in your readlist for 30 days.";
const PAY_FOOTER_REASON = "You're getting this because you save articles to Readplace.";
const AMBER_FILL = "rgb(173, 98, 37)";

const item = (overrides: Partial<QueueDigestEmailItem> = {}): QueueDigestEmailItem => ({
	articleId: ARTICLE_ID,
	title: "Distributed systems",
	siteName: "example.com",
	preview: "A tidy teaser.",
	...overrides,
});

const regularDigest = (items: QueueDigestEmailItem[]) =>
	QueueDigestEmail({ kind: "regular", items, links: LINKS });
const payDigest = (items: QueueDigestEmailItem[]) =>
	QueueDigestEmail({ kind: "pay", items, links: LINKS, pay: { trialEndsAt: TRIAL_ENDS_AT } });

const documentOf = (html: string) => new JSDOM(html).window.document;
const anchorsOf = (html: string) => [...documentOf(html).querySelectorAll("a[href]")];
const urlOf = (anchor: Element) => new URL(anchor.getAttribute("href") ?? "");
const linksTo = (html: string, pathname: string) =>
	anchorsOf(html)
		.map(urlOf)
		.filter((url) => url.pathname === pathname);
const readableTextOf = (html: string) => (documentOf(html).body.textContent ?? "").replace(/\s+/g, " ");
const amberButtonPathsOf = (html: string) =>
	anchorsOf(html)
		.filter((anchor) => anchor.parentElement?.style.backgroundColor === AMBER_FILL)
		.map((anchor) => urlOf(anchor).pathname);

describe("QueueDigestEmail", () => {
	describe("subject", () => {
		it("names the email after the reader's own unread articles, for both kinds", () => {
			expect(regularDigest([item()]).subject).toBe("Waiting in your readlist");
			expect(payDigest([item()]).subject).toBe("Waiting in your readlist");
		});
	});

	describe("headers", () => {
		it("offers the RFC 8058 one-click unsubscribe at the digest's unsubscribe address", () => {
			expect(regularDigest([item()]).headers).toEqual({
				"List-Unsubscribe": `<https://readplace.com/email/queue-digest/unsubscribe?t=${UNSUBSCRIBE_TOKEN}>`,
				"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
			});
		});
	});

	describe("text/html body", () => {
		it("heads the email with its subject", () => {
			const doc = documentOf(regularDigest([item()]).to("text/html"));

			expect(doc.title).toBe("Waiting in your readlist");
			expect(doc.querySelector("h1")?.textContent).toBe("Waiting in your readlist");
		});

		it("tells a regular-digest reader the articles are old unread saves, that this is a one-time reminder about them and how often these come, pluralising from the count", () => {
			expect(readableTextOf(regularDigest([item()]).to("text/html"))).toContain(
				"This article has been in your readlist for at least 30 days and is still marked unread. This is a one-time reminder about it. Readplace sends these at most once every 7 days.",
			);
			expect(
				readableTextOf(regularDigest([item(), item({ articleId: SECOND_ARTICLE_ID })]).to("text/html")),
			).toContain(
				"These 2 articles have been in your readlist for at least 30 days and are still marked unread. This is a one-time reminder about them. Readplace sends these at most once every 7 days.",
			);
		});

		it("counts the articles listed in a pay digest, pluralising from the count", () => {
			expect(readableTextOf(payDigest([item()]).to("text/html"))).toContain("1 article you saved is ready to read.");
			expect(
				readableTextOf(payDigest([item(), item({ articleId: SECOND_ARTICLE_ID })]).to("text/html")),
			).toContain("2 articles you saved are ready to read.");
		});

		it("never tells a pay-digest reader the articles are old or that this is a one-time reminder, since a pay digest lists any unread save", () => {
			const text = readableTextOf(payDigest([item()]).to("text/html"));

			expect(text).not.toContain("30 days");
			expect(text).not.toContain("one-time reminder");
		});

		it("links a card's title, site name and preview to that article's owner reader view, carrying the login marker and the digest's click tags", () => {
			const html = regularDigest([item()]).to("text/html");

			const cardLinks = anchorsOf(html).filter(
				(anchor) => urlOf(anchor).pathname === `/queue/${ARTICLE_ID.value}/view`,
			);
			expect(cardLinks.map((anchor) => anchor.textContent?.trim())).toEqual([
				"Distributed systems",
				"example.com",
				"A tidy teaser.",
			]);
			for (const anchor of cardLinks) {
				expect(Object.fromEntries(urlOf(anchor).searchParams)).toEqual({
					from: "reader-ready-email",
					utm_source: "queue-digest",
					utm_medium: "email",
					utm_campaign: "regular",
					utm_content: "article",
					utm_term: SEND_ID,
				});
			}
		});

		it("gives each card its own reader permalink", () => {
			const html = regularDigest([
				item({ title: "One", articleId: ARTICLE_ID }),
				item({ title: "Two", articleId: SECOND_ARTICLE_ID }),
			]).to("text/html");

			const titleLinks = anchorsOf(html).filter((anchor) =>
				["One", "Two"].includes(anchor.textContent?.trim() ?? ""),
			);
			expect(titleLinks.map((anchor) => urlOf(anchor).pathname)).toEqual([
				`/queue/${ARTICLE_ID.value}/view`,
				`/queue/${SECOND_ARTICLE_ID.value}/view`,
			]);
		});

		it.each([
			["regular", regularDigest],
			["pay", payDigest],
		])(
			"never offers a %s-digest reader a link to the article's original site, even when the site name and preview name domains",
			(_kind, buildDigest) => {
				const html = buildDigest([
					item({ siteName: "engineering.linkedin.com", preview: "Also covered on dataintensive.net today." }),
				]).to("text/html");

				const anchors = anchorsOf(html);
				expect(anchors.map((anchor) => urlOf(anchor).origin)).toEqual(anchors.map(() => ORIGIN));
				for (const domainText of ["engineering.linkedin.com", "Also covered on dataintensive.net today."]) {
					const holder = anchors.find((anchor) => anchor.textContent?.trim() === domainText);
					assert(holder, `${domainText} must sit inside an anchor`);
					expect(urlOf(holder).pathname).toBe(`/queue/${ARTICLE_ID.value}/view`);
				}
			},
		);

		it("renders one continue-reading link to the readlist, after the last card", () => {
			const html = regularDigest([item({ title: "Only card" })]).to("text/html");

			const anchors = anchorsOf(html);
			const continueLinks = anchors.filter((anchor) => urlOf(anchor).pathname === "/queue");
			expect(continueLinks).toHaveLength(1);
			expect(Object.fromEntries(urlOf(continueLinks[0]).searchParams)).toEqual({
				utm_source: "queue-digest",
				utm_medium: "email",
				utm_campaign: "regular",
				utm_content: "continue-reading",
				utm_term: SEND_ID,
			});
			const paths = anchors.map((anchor) => urlOf(anchor).pathname);
			expect(paths.indexOf("/queue")).toBeGreaterThan(paths.lastIndexOf(`/queue/${ARTICLE_ID.value}/view`));
		});

		it("renders a card with no body when an item has no preview", () => {
			const html = regularDigest([item({ title: "No content", preview: "" })]).to("text/html");

			expect(
				anchorsOf(html)
					.filter((anchor) => urlOf(anchor).pathname === `/queue/${ARTICLE_ID.value}/view`)
					.map((anchor) => anchor.textContent?.trim()),
			).toEqual(["No content", "example.com"]);
		});

		it("HTML-escapes the title and preview so crafted content cannot inject markup", () => {
			const html = regularDigest([
				item({ title: "<script>alert(1)</script>", preview: "<img src=x onerror=alert(2)>" }),
			]).to("text/html");

			expect(html).not.toContain("<script>alert(1)</script>");
			expect(html).not.toContain("<img src=x onerror=alert(2)>");
			expect(html).toContain("&lt;script&gt;");
		});

		it("carries exactly one keep-Readplace link to the plans page in a pay digest, tagged with the pay campaign and the send id, beside charge terms that stay true whenever the email is read", () => {
			const html = payDigest([item()]).to("text/html");

			const plansLinks = linksTo(html, "/account/plans");
			expect(plansLinks).toHaveLength(1);
			expect(Object.fromEntries(plansLinks[0].searchParams)).toEqual({
				utm_source: "queue-digest",
				utm_medium: "email",
				utm_campaign: "pay",
				utm_content: "keep-readplace",
				utm_term: SEND_ID,
			});
			expect(readableTextOf(html)).toContain(PAY_TERMS);
		});

		it("leaves the plans link and the charge terms out of a regular digest", () => {
			const html = regularDigest([item()]).to("text/html");

			expect(linksTo(html, "/account/plans")).toEqual([]);
			expect(readableTextOf(html)).not.toContain("Choose a plan");
		});

		it("tags every link of a pay digest with the pay campaign", () => {
			const html = payDigest([item()]).to("text/html");

			const campaigns = anchorsOf(html).map((anchor) => urlOf(anchor).searchParams.get("utm_campaign"));
			expect(campaigns).toEqual(campaigns.map(() => "pay"));
		});

		it("keeps one amber button per email: continue reading in a regular digest, keep Readplace in a pay digest", () => {
			expect(amberButtonPathsOf(regularDigest([item()]).to("text/html"))).toEqual(["/queue"]);
			expect(amberButtonPathsOf(payDigest([item()]).to("text/html"))).toEqual(["/account/plans"]);
		});

		it.each([
			["regular", regularDigest, REGULAR_FOOTER_REASON],
			["pay", payDigest, PAY_FOOTER_REASON],
		])("closes a %s digest with why it arrived, its unsubscribe link and the postal address", (kind, buildDigest, footerReason) => {
			const html = buildDigest([item()]).to("text/html");

			const unsubscribeLinks = linksTo(html, "/email/queue-digest/unsubscribe");
			expect(unsubscribeLinks).toHaveLength(1);
			expect(Object.fromEntries(unsubscribeLinks[0].searchParams)).toEqual({
				t: UNSUBSCRIBE_TOKEN,
				utm_source: "queue-digest",
				utm_medium: "email",
				utm_campaign: kind,
				utm_content: "unsubscribe",
				utm_term: SEND_ID,
			});
			const text = readableTextOf(html);
			expect(text).toContain(`${footerReason} Stop these emails.`);
			expect(text).toContain(POSTAL_ADDRESS);
		});

		it.each([
			["regular", regularDigest],
			["pay", payDigest],
		])("carries no exclamation mark in a %s digest", (_kind, buildDigest) => {
			const email = buildDigest([item()]);

			expect(`${email.subject} ${readableTextOf(email.to("text/html"))}`).not.toContain("!");
		});
	});

	describe("text/plain body", () => {
		it("lists every title with its reader link, and names no article's site, which a mail client would turn into a link to the original site", () => {
			const text = regularDigest([
				item({ title: "One", articleId: ARTICLE_ID, siteName: "engineering.linkedin.com" }),
				item({ title: "Two", articleId: SECOND_ARTICLE_ID, siteName: "dataintensive.net" }),
			]).to("text/plain");

			const tags = `utm_source=queue-digest&utm_medium=email&utm_campaign=regular&utm_content=article&utm_term=${SEND_ID}`;
			expect(text).toContain(
				`One\nhttps://readplace.com/queue/${ARTICLE_ID.value}/view?from=reader-ready-email&${tags}`,
			);
			expect(text).toContain(
				`Two\nhttps://readplace.com/queue/${SECOND_ARTICLE_ID.value}/view?from=reader-ready-email&${tags}`,
			);
			expect(text).not.toContain("engineering.linkedin.com");
			expect(text).not.toContain("dataintensive.net");
		});

		it("opens with the subject and why these articles were sent, and offers the readlist link", () => {
			const text = regularDigest([item()]).to("text/plain");

			expect(
				text.startsWith(
					"Waiting in your readlist\n\nThis article has been in your readlist for at least 30 days and is still marked unread.\n\nThis is a one-time reminder about it. Readplace sends these at most once every 7 days.\n\n",
				),
			).toBe(true);
			expect(text).toContain(
				`Continue reading: https://readplace.com/queue?utm_source=queue-digest&utm_medium=email&utm_campaign=regular&utm_content=continue-reading&utm_term=${SEND_ID}`,
			);
		});

		it("carries the charge terms, right after the readlist link, and the keep-Readplace link in a pay digest", () => {
			const text = payDigest([item()]).to("text/plain");

			expect(text).toContain(
				`utm_content=continue-reading&utm_term=${SEND_ID}\n\n${PAY_TERMS}\n\nKeep Readplace: https://readplace.com/account/plans?utm_source=queue-digest&utm_medium=email&utm_campaign=pay&utm_content=keep-readplace&utm_term=${SEND_ID}`,
			);
		});

		it("leaves the charge terms and the plans link out of a regular digest", () => {
			const text = regularDigest([item()]).to("text/plain");

			expect(text).not.toContain("Choose a plan");
			expect(text).not.toContain("/account/plans");
		});

		it("ends with the reply invitation, why it arrived with its unsubscribe link, and the postal address", () => {
			const text = regularDigest([item()]).to("text/plain");

			expect(
				text.endsWith(
					[
						"If you have any questions, please reply to this email",
						`${REGULAR_FOOTER_REASON} Stop these emails: https://readplace.com/email/queue-digest/unsubscribe?t=${UNSUBSCRIBE_TOKEN}&utm_source=queue-digest&utm_medium=email&utm_campaign=regular&utm_content=unsubscribe&utm_term=${SEND_ID}`,
						POSTAL_ADDRESS,
					].join("\n\n"),
				),
			).toBe(true);
		});

		it.each([
			["regular", regularDigest],
			["pay", payDigest],
		])("carries no exclamation mark in a %s digest", (_kind, buildDigest) => {
			expect(buildDigest([item()]).to("text/plain")).not.toContain("!");
		});
	});
});
