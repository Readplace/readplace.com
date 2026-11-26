import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "../../email-colors";
import { render } from "@packages/web-shell";
import { EXPORT_DOWNLOAD_TTL_DAYS } from "./export-ttl";
import { renderEmailCard } from "../../email-card";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchEmails } from "@packages/translations/hutch-emails";

const { t } = translator(hutchEmails, DEFAULT_LOCALE);

const TEMPLATE = readFileSync(
	join(__dirname, "user-data-export-email.template.html"),
	"utf-8",
);

export function buildUserDataExportEmailHtml(params: {
	downloadUrl: string;
	articleCount: number;
}): string {
	const { downloadUrl, articleCount } = params;
	return renderEmailCard({
		titleHtml: t("userDataExportEmail.title"),
		body: render(TEMPLATE, {
			downloadUrl,
			articleCountLabel: `${articleCount} article${articleCount === 1 ? "" : "s"}`,
			ttlDays: EXPORT_DOWNLOAD_TTL_DAYS,
			colors: EMAIL_COLORS,
		}),
	});
}
