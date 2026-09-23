import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS, EMAIL_FONT_STACK } from "../../email-colors";
import { render } from "@packages/web-shell";

const TEMPLATE = readFileSync(
	join(__dirname, "user-data-export-email.template.html"),
	"utf-8",
);

export function buildUserDataExportEmailHtml(params: {
	downloadUrl: string;
	articleCount: number;
	ttlDays: number;
}): string {
	const { downloadUrl, articleCount, ttlDays } = params;
	return render(TEMPLATE, {
		downloadUrl,
		articleCountLabel: `${articleCount} article${articleCount === 1 ? "" : "s"}`,
		ttlDays,
		colors: EMAIL_COLORS,
		fontStack: EMAIL_FONT_STACK,
	});
}
