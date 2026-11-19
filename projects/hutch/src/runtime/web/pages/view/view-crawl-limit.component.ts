import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReader } from "@packages/translations/hutch-reader";
import { render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { VIEW_CRAWL_LIMIT_STYLES } from "./view-crawl-limit.styles";

export const VIEW_CRAWL_LIMIT_SOURCE = "view-crawl-limit";

const VIEW_CRAWL_LIMIT_TEMPLATE = readFileSync(join(__dirname, "view-crawl-limit.template.html"), "utf-8");

const { t, tPlural } = translator(hutchReader, DEFAULT_LOCALE);

function retryWaitFor(retryAfterSeconds: number): string {
	if (retryAfterSeconds <= 3600) {
		return tPlural("view.crawlLimit.minutes", { count: Math.max(1, Math.ceil(retryAfterSeconds / 60)) });
	}
	return tPlural("view.crawlLimit.hours", { count: Math.round(retryAfterSeconds / 3600) });
}

export function ViewCrawlLimitPage(input: { retryAfterSeconds: number }): PageBody {
	return {
		seo: {
			title: t("view.crawlLimit.seoTitle"),
			description: t("view.crawlLimit.seoDescription"),
			canonicalUrl: "https://readplace.com/signup",
			robots: "noindex, nofollow",
		},
		styles: VIEW_CRAWL_LIMIT_STYLES,
		bodyClass: "page-view-crawl-limit",
		content: {
			html: render(VIEW_CRAWL_LIMIT_TEMPLATE, {
				signupHref: withInternalTracking("/signup", { source: VIEW_CRAWL_LIMIT_SOURCE, content: "signup" }),
				loginHref: withInternalTracking("/login", { source: VIEW_CRAWL_LIMIT_SOURCE, content: "login" }),
				retryWait: retryWaitFor(input.retryAfterSeconds),
			}),
		},
		statusCode: 429,
	};
}
