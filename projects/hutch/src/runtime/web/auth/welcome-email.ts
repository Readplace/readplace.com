import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "../email-colors";
import { render } from "../render";

const WELCOME_EMAIL_TEMPLATE = readFileSync(join(__dirname, "welcome-email.template.html"), "utf-8");

export function buildWelcomeEmailHtml({
	installUrl,
	avatarUrl,
}: {
	installUrl: string;
	avatarUrl: string;
}): string {
	return render(WELCOME_EMAIL_TEMPLATE, {
		installUrl,
		avatarUrl,
		colors: EMAIL_COLORS,
	});
}
