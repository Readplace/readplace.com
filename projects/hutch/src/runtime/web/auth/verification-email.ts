import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS, EMAIL_FONT_STACK } from "../email-colors";
import { render } from "@packages/web-shell";
import { emailTrackedUrl } from "@packages/web-analytics";

const TEMPLATE = readFileSync(
	join(__dirname, "verification-email.template.html"),
	"utf-8",
);

function verifyCtaUrl(verifyUrl: string): string {
	return emailTrackedUrl({ url: verifyUrl, source: "verification-email", content: "verify-email" });
}

export function buildVerificationEmailHtml(verifyUrl: string): string {
	return render(TEMPLATE, {
		verifyUrl: verifyCtaUrl(verifyUrl),
		colors: EMAIL_COLORS,
		fontStack: EMAIL_FONT_STACK,
	});
}
