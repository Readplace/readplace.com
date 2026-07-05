import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "../email-colors";
import { SAVE_SURFACES_PHRASE } from "../shared/client-surface-phrases";
import { render } from "@packages/web-shell";

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
		saveSurfaces: SAVE_SURFACES_PHRASE,
		colors: EMAIL_COLORS,
	});
}
