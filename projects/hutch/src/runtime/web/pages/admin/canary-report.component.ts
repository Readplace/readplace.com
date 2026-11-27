import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type PageBody, render } from "@packages/web-shell";
import { type CanaryName, type CanaryReport, canaryReportPath } from "@packages/provider-contracts/canary-report";
import { parseHttpUrl } from "@packages/domain/inbox";
import { CANARY_REPORT_STYLES } from "./canary-report.styles";

const TEMPLATE = readFileSync(join(__dirname, "canary-report.template.html"), "utf-8");

const TITLES: Record<CanaryName, string> = {
	"failed-articles": "Failed articles canary report",
	"stuck-articles": "Stuck articles canary report",
};

export function CanaryReportPage(report: CanaryReport): PageBody {
	const html = render(TEMPLATE, {
		canary: report.canary,
		title: TITLES[report.canary],
		runUrl: report.runUrl,
		createdAt: report.createdAt,
		rowCount: report.rows.length,
		rows: report.rows.map((row, index) => ({
			rowIndex: index + 1,
			url: row.url,
			href: parseHttpUrl(row.url) === undefined ? undefined : row.url,
			labels: row.labels,
			detail: row.detail,
			savedAt: row.savedAt ?? "-",
			contentFetchedAt: row.contentFetchedAt ?? "-",
		})),
	});
	return {
		seo: {
			title: "Canary report | Admin | Readplace",
			description: "Operator tools. Not for public consumption.",
			canonicalUrl: canaryReportPath(report),
			robots: "noindex, nofollow",
		},
		styles: CANARY_REPORT_STYLES,
		bodyClass: "page-admin-canary-report",
		content: { html },
	};
}
