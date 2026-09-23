import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS, EMAIL_FONT_STACK } from "../email-colors";
import { render } from "@packages/web-shell";

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
	return render(TEMPLATE, {
		verifyUrl: verifyCtaUrl(verifyUrl),
		colors: EMAIL_COLORS,
		fontStack: EMAIL_FONT_STACK,
	});
}
