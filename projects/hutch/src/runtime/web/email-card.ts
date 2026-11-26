import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { EMAIL_COLORS, EMAIL_FONT_STACK } from "./email-colors";

const CARD_TEMPLATE = readFileSync(join(__dirname, "email-card.template.html"), "utf-8");

const MESSAGE_TEMPLATE = readFileSync(join(__dirname, "email-card-message.template.html"), "utf-8");

type EmailCardNote = { html: string } | { text: string };

type EmailCardParagraph = EmailCardNote | { address: { before: string; address: string; after: string } };

interface EmailCardMessage {
	titleHtml: string;
	founderAvatarUrl?: string;
	paragraphs: readonly EmailCardParagraph[];
	cta?: { url: string; label: string };
	notes?: readonly EmailCardNote[];
	signoff?: string;
}

export function renderEmailCard(input: { titleHtml: string; body: string }): string {
	return render(CARD_TEMPLATE, {
		titleHtml: input.titleHtml,
		body: input.body.trimEnd(),
		colors: EMAIL_COLORS,
		fontStack: EMAIL_FONT_STACK,
	});
}

export function renderEmailCardMessage(message: EmailCardMessage): string {
	return renderEmailCard({
		titleHtml: message.titleHtml,
		body: render(MESSAGE_TEMPLATE, { ...message, colors: EMAIL_COLORS }),
	});
}
