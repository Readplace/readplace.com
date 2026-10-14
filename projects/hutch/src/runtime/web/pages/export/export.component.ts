import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { EXPORT_DOWNLOAD_TTL_DAYS } from "./export-ttl";
import { EXPORT_STYLES } from "./export.styles";

const EXPORT_TEMPLATE = readFileSync(join(__dirname, "export.template.html"), "utf-8");
const EXPORT_PREPARING_TEMPLATE = readFileSync(
	join(__dirname, "export-preparing.template.html"),
	"utf-8",
);

export function ExportPage(params: { status: "idle" | "preparing" }): PageBody {
	const content =
		params.status === "preparing"
			? render(EXPORT_PREPARING_TEMPLATE, {
					ttlDays: String(EXPORT_DOWNLOAD_TTL_DAYS),
				})
			: render(EXPORT_TEMPLATE, {
					ttlDays: String(EXPORT_DOWNLOAD_TTL_DAYS),
				});

	return {
		seo: {
			title: "Export your data — Readplace",
			description: "Download a list of the articles you saved on Readplace.",
			canonicalUrl: "/export",
			robots: "noindex, nofollow",
		},
		styles: EXPORT_STYLES,
		bodyClass: "page-export",
		content: { html: content },
	};
}
