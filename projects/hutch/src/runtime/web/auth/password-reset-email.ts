import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "../email-colors";
import { render } from "@packages/web-shell";
import { renderEmailCard } from "../email-card";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchEmails } from "@packages/translations/hutch-emails";

const { t } = translator(hutchEmails, DEFAULT_LOCALE);

const TEMPLATE = readFileSync(
	join(__dirname, "password-reset-email.template.html"),
	"utf-8",
);

function resetCtaUrl(resetUrl: string): string {
	const url = new URL(resetUrl);
	url.searchParams.set("utm_source", "password-reset-email");
	url.searchParams.set("utm_medium", "email");
	url.searchParams.set("utm_content", "reset-password");
	return url.toString();
}

export function buildPasswordResetEmailHtml(resetUrl: string): string {
	return renderEmailCard({
		titleHtml: t("passwordResetEmail.title"),
		body: render(TEMPLATE, {
			resetUrl: resetCtaUrl(resetUrl),
			colors: EMAIL_COLORS,
		}),
	});
}
