import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReader } from "@packages/translations/hutch-reader";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { VIEW_CRAWL_LIMIT_STYLES } from "./view-crawl-limit.styles";

const { t } = translator(hutchReader, DEFAULT_LOCALE);

const VIEW_DAILY_SAVE_LIMIT_TEMPLATE = readFileSync(join(__dirname, "view-daily-save-limit.template.html"), "utf-8");

export function ViewDailySaveLimitPage(): PageBody {
	return {
		seo: {
			title: t("reader.dailySaveLimit.title"),
			description: t("reader.dailySaveLimit.body"),
			canonicalUrl: "/queue",
			robots: "noindex, nofollow",
		},
		styles: VIEW_CRAWL_LIMIT_STYLES,
		bodyClass: "page-view-daily-save-limit",
		content: { html: render(VIEW_DAILY_SAVE_LIMIT_TEMPLATE, {}) },
		statusCode: 429,
	};
}
