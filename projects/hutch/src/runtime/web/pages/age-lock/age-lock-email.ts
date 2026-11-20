import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchEmails } from "@packages/translations/hutch-emails";
import { render } from "@packages/web-shell";
import { EMAIL_COLORS, EMAIL_FONT_STACK } from "../../email-colors";

const TEMPLATE = readFileSync(join(__dirname, "age-lock-email.template.html"), "utf-8");

const { t } = translator(hutchEmails, DEFAULT_LOCALE);

export function ageLockEmail(params: { unlockUrl: string }): { subject: string; html: string } {
	return {
		subject: t("ageLockEmail.subject"),
		html: render(TEMPLATE, {
			title: t("ageLockEmail.title"),
			paragraphs: [t("ageLockEmail.reported"), t("ageLockEmail.deletion")],
			ctaUrl: params.unlockUrl,
			ctaLabel: t("ageLockEmail.cta"),
			colors: EMAIL_COLORS,
			fontStack: EMAIL_FONT_STACK,
		}),
	};
}
