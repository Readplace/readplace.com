import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchIntegrations } from "@packages/translations/hutch-integrations";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { EXPORT_DOWNLOAD_TTL_DAYS } from "./export-ttl";
import { EXPORT_STYLES } from "./export.styles";

const { tPlural } = translator(hutchIntegrations, DEFAULT_LOCALE);

const EXPORT_TEMPLATE = readFileSync(join(__dirname, "export.template.html"), "utf-8");
const EXPORT_PREPARING_TEMPLATE = readFileSync(
	join(__dirname, "export-preparing.template.html"),
	"utf-8",
);
const EXPORT_LIMIT_REACHED_TEMPLATE = readFileSync(
	join(__dirname, "export-limit-reached.template.html"),
	"utf-8",
);

const ONE_HOUR_SECONDS = 3600;

type ExportPageParams =
	| { status: "idle" | "preparing" }
	| { status: "limit-reached"; limit: number; retryAfterSeconds: number };

function contentOf(params: ExportPageParams): Pick<PageBody, "content" | "statusCode"> {
	const ttlDays = String(EXPORT_DOWNLOAD_TTL_DAYS);
	switch (params.status) {
		case "idle":
			return { content: { html: render(EXPORT_TEMPLATE, { ttlDays }) } };
		case "preparing":
			return { content: { html: render(EXPORT_PREPARING_TEMPLATE, { ttlDays }) } };
		case "limit-reached":
			return {
				content: {
					html: render(EXPORT_LIMIT_REACHED_TEMPLATE, {
						ttlDays,
						limitLine: tPlural("exportLimitReached.limit", { count: params.limit }),
						retryLine: tPlural("exportLimitReached.retry", {
							count: Math.max(1, Math.ceil(params.retryAfterSeconds / ONE_HOUR_SECONDS)),
						}),
					}),
				},
				statusCode: 429,
			};
	}
}

export function ExportPage(params: ExportPageParams): PageBody {
	return {
		seo: {
			title: "Export your data — Readplace",
			description: "Download a list of the articles you saved on Readplace.",
			canonicalUrl: "/export",
			robots: "noindex, nofollow",
		},
		styles: EXPORT_STYLES,
		bodyClass: "page-export",
		...contentOf(params),
	};
}
