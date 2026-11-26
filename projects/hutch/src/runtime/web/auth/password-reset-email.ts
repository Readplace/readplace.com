import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS, EMAIL_FONT_STACK } from "../email-colors";
import { render } from "@packages/web-shell";
import { emailTrackedUrl } from "@packages/web-analytics";

const TEMPLATE = readFileSync(
	join(__dirname, "password-reset-email.template.html"),
	"utf-8",
);

function resetCtaUrl(resetUrl: string): string {
	return emailTrackedUrl({ url: resetUrl, source: "password-reset-email", content: "reset-password" });
}

export function buildPasswordResetEmailHtml(resetUrl: string): string {
	return render(TEMPLATE, {
		resetUrl: resetCtaUrl(resetUrl),
		colors: EMAIL_COLORS,
		fontStack: EMAIL_FONT_STACK,
	});
}
