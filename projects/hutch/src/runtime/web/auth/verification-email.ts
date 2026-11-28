import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "../email-colors";
import { render } from "@packages/web-shell";
import { renderEmailCard } from "../email-card";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchEmails } from "@packages/translations/hutch-emails";

const { t } = translator(hutchEmails, DEFAULT_LOCALE);

const TEMPLATE = readFileSync(
	join(__dirname, "verification-email.template.html"),
	"utf-8",
);

function verifyCtaUrl(verifyUrl: string): string {
	const url = new URL(verifyUrl);
	url.searchParams.set("utm_source", "verification-email");
	url.searchParams.set("utm_medium", "email");
	url.searchParams.set("utm_content", "verify-email");
	return url.toString();
}

export function buildVerificationEmailHtml(verifyUrl: string): string {
	return renderEmailCard({
		titleHtml: t("verificationEmail.title"),
		body: render(TEMPLATE, {
			verifyUrl: verifyCtaUrl(verifyUrl),
			colors: EMAIL_COLORS,
		}),
	});
}
