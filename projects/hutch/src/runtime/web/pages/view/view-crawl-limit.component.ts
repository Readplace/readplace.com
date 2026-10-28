import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { VIEW_CRAWL_LIMIT_STYLES } from "./view-crawl-limit.styles";

export const VIEW_CRAWL_LIMIT_SOURCE = "view-crawl-limit";

const VIEW_CRAWL_LIMIT_TEMPLATE = readFileSync(join(__dirname, "view-crawl-limit.template.html"), "utf-8");

export function ViewCrawlLimitPage(input: { retryAfterSeconds: number }): PageBody {
	return {
		seo: {
			title: "Create a free account to keep reading — Readplace",
			description: "You've opened a lot of new links this hour.",
			canonicalUrl: "https://readplace.com/signup",
			robots: "noindex, nofollow",
		},
		styles: VIEW_CRAWL_LIMIT_STYLES,
		bodyClass: "page-view-crawl-limit",
		content: {
			html: render(VIEW_CRAWL_LIMIT_TEMPLATE, {
				signupHref: withInternalTracking("/signup", { source: VIEW_CRAWL_LIMIT_SOURCE, content: "signup" }),
				loginHref: withInternalTracking("/login", { source: VIEW_CRAWL_LIMIT_SOURCE, content: "login" }),
				retryMinutes: Math.max(1, Math.ceil(input.retryAfterSeconds / 60)),
			}),
		},
		statusCode: 429,
	};
}
