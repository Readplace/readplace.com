import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GMAIL_HISTORY_IMPORT_WINDOW_DAYS } from "@packages/domain/gmail";
import { render } from "@packages/web-shell";
import { GMAIL_NEWSLETTER_NOTICE_INTERVAL_DAYS } from "../../domain/gmail/gmail-newsletter-notice-cadence";
import { EMAIL_COLORS, EMAIL_FONT_STACK } from "../email-colors";
import { EMAIL_REPLY_INVITATION } from "../email-copy";

const TEMPLATE = readFileSync(join(__dirname, "gmail-newsletter-notice-email.template.html"), "utf-8");
const CTA_LABEL = "Choose readlists";
const SIGNOFF = "— Fayner Brack, Founder & CEO";
const NAME_LINE_STYLE = `font-size:16px;font-weight:600;line-height:1.4;color:${EMAIL_COLORS.primaryText};text-decoration:underline;`;
const ADDRESS_LINE_STYLE = `font-size:14px;line-height:1.6;color:${EMAIL_COLORS.mutedForeground};text-decoration:none;`;

export interface GmailNewsletterNoticeItem {
	newsletterName: string | undefined;
	senderEmail: string;
	choiceUrl: string;
}

function singleCopy(newsletter: GmailNewsletterNoticeItem) {
	const label = newsletter.newsletterName ?? newsletter.senderEmail;
	return {
		subject: `Choose readlists for ${label}`,
		opening: {
			before: newsletter.newsletterName === undefined ? "Readplace recognizes this newsletter in your Gmail: " : `Readplace recognizes ${newsletter.newsletterName} in your Gmail: `,
			address: newsletter.senderEmail,
			after: ". It is ready to connect to your readlists.",
		},
		paragraph: `Choose readlists and Save to send its future emails to Readplace. What you choose to save — the issue itself, the articles it links to, or both — goes to All and any readlists you pick. You can also choose to import earlier unread messages from the last ${GMAIL_HISTORY_IMPORT_WINDOW_DAYS} days.`,
		footer: `You are receiving this email because you haven't chosen readlists for this newsletter. This is a one-time notification for ${label}.`,
	};
}

function groupCopy(count: number) {
	return {
		subject: `Choose readlists for ${count} newsletters`,
		introLine: `Readplace recognizes ${count} newsletters in your Gmail that are ready to connect to your readlists:`,
		paragraph: `Choose readlists for a newsletter and Save to send its future emails to Readplace. What you choose to save — the issue itself, the articles it links to, or both — goes to All and any readlists you pick. You can also choose to import earlier unread messages from the last ${GMAIL_HISTORY_IMPORT_WINDOW_DAYS} days.`,
		footer: "You are receiving this email because you haven't chosen readlists for these newsletters. This is a one-time notification for each of them.",
	};
}

function waitingCopy(waiting: number): { text: string }[] {
	if (waiting === 0) return [];
	if (waiting === 1) return [{ text: `1 more newsletter is waiting and will be in your next email in about ${GMAIL_NEWSLETTER_NOTICE_INTERVAL_DAYS} days.` }];
	return [{ text: `${waiting} more newsletters are waiting and will be in your next email in about ${GMAIL_NEWSLETTER_NOTICE_INTERVAL_DAYS} days.` }];
}

export function GmailNewsletterNoticeEmail(input: { founderAvatarUrl: string; newsletters: readonly GmailNewsletterNoticeItem[]; gmailUrl: string; waiting: number }) {
	assert(input.newsletters.length > 0, "A Gmail newsletter notice lists at least one newsletter");
	assert(input.newsletters.length > 1 || input.waiting === 0, "A single-newsletter Gmail notice never leaves newsletters waiting");
	const [first] = input.newsletters;
	const shared = { founderAvatarUrl: input.founderAvatarUrl, ctaLabel: CTA_LABEL, replyLine: EMAIL_REPLY_INVITATION, signoff: SIGNOFF, colors: EMAIL_COLORS, fontStack: EMAIL_FONT_STACK };
	if (input.newsletters.length === 1) {
		const copy = singleCopy(first);
		return {
			subject: copy.subject,
			to(mediaType: "text/html" | "text/plain"): string {
				if (mediaType === "text/html") return render(TEMPLATE, { ...shared, subject: copy.subject, openings: [copy.opening], lists: [], paragraph: copy.paragraph, ctaUrl: first.choiceUrl, footer: copy.footer });
				return [`${copy.opening.before}${copy.opening.address}${copy.opening.after}`, copy.paragraph, `${CTA_LABEL}: ${first.choiceUrl}`, EMAIL_REPLY_INVITATION, SIGNOFF, copy.footer].join("\n\n");
			},
		};
	}
	const copy = groupCopy(input.newsletters.length);
	const notes = waitingCopy(input.waiting);
	const items = input.newsletters.map((newsletter) => ({
		url: newsletter.choiceUrl,
		lines: newsletter.newsletterName === undefined
			? [{ text: newsletter.senderEmail, style: NAME_LINE_STYLE }]
			: [{ text: newsletter.newsletterName, style: NAME_LINE_STYLE }, { text: newsletter.senderEmail, style: ADDRESS_LINE_STYLE }],
		plain: newsletter.newsletterName === undefined
			? `${newsletter.senderEmail}: ${newsletter.choiceUrl}`
			: `${newsletter.newsletterName} (${newsletter.senderEmail}): ${newsletter.choiceUrl}`,
	}));
	return {
		subject: copy.subject,
		to(mediaType: "text/html" | "text/plain"): string {
			if (mediaType === "text/html") return render(TEMPLATE, { ...shared, subject: copy.subject, openings: [], lists: [{ introLine: copy.introLine, items, notes }], paragraph: copy.paragraph, ctaUrl: input.gmailUrl, footer: copy.footer });
			return [
				copy.introLine,
				...items.map((item) => item.plain),
				...notes.map((note) => note.text),
				copy.paragraph,
				`${CTA_LABEL}: ${input.gmailUrl}`,
				EMAIL_REPLY_INVITATION,
				SIGNOFF,
				copy.footer,
			].join("\n\n");
		},
	};
}
