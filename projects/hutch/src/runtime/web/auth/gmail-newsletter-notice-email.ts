import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { EMAIL_COLORS, EMAIL_FONT_STACK } from "../email-colors";
import { EMAIL_REPLY_INVITATION } from "../email-copy";

const TEMPLATE = readFileSync(join(__dirname, "gmail-newsletter-notice-email.template.html"), "utf-8");
const PARAGRAPH = "Every eligible article from this newsletter is saved to All. Choose any additional readlists and Save to send future emails to Readplace. You can also choose to import earlier unread messages from the last 30 days.";
const CTA_LABEL = "Choose readlists";
const SIGNOFF = "— Fayner Brack, Founder & CEO";

export function GmailNewsletterNoticeEmail(input: { founderAvatarUrl: string; newsletterName: string | undefined; senderEmail: string; gmailUrl: string }) {
	const opening = { before: input.newsletterName === undefined ? "Readplace recognizes this newsletter in your Gmail: " : `Readplace recognizes ${input.newsletterName} in your Gmail: `, address: input.senderEmail, after: ". It is ready to connect to your readlists." };
	return {
		to(mediaType: "text/html" | "text/plain"): string {
			if (mediaType === "text/html") return render(TEMPLATE, { founderAvatarUrl: input.founderAvatarUrl, opening, paragraphs: [PARAGRAPH], ctaUrl: input.gmailUrl, ctaLabel: CTA_LABEL, replyLine: EMAIL_REPLY_INVITATION, signoff: SIGNOFF, colors: EMAIL_COLORS, fontStack: EMAIL_FONT_STACK });
			return [`${opening.before}${opening.address}${opening.after}`, PARAGRAPH, `${CTA_LABEL}: ${input.gmailUrl}`, EMAIL_REPLY_INVITATION, SIGNOFF].join("\n\n");
		},
	};
}
