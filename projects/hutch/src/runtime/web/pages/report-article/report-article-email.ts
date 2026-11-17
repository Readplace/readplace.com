import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EmailMessage } from "@packages/provider-contracts/email";
import { render } from "@packages/web-shell";
import { type ReportReason, reportReasonLabel } from "../../shared/report-article/report-article-dialog.component";

const TEMPLATE = readFileSync(join(__dirname, "report-article-email.template.html"), "utf-8");

export const REPORT_ADDRESS = "readplace+report@readplace.com";
export const REPORT_FROM = "Readplace Reports <readplace@readplace.com>";

export type Reporter =
	| { kind: "account"; email: string }
	| { kind: "given"; email: string }
	| { kind: "anonymous" };

export interface ArticleReport {
	articleUrl: string;
	title: string;
	reason?: ReportReason;
	details?: string;
	reporter: Reporter;
}

function reporterLine(reporter: Reporter): string {
	switch (reporter.kind) {
		case "account":
			return `Signed-in reader ${reporter.email}`;
		case "given":
			return `Not signed in, gave the email ${reporter.email}`;
		case "anonymous":
			return "Not signed in, and gave no email";
	}
}

export function buildReportArticleEmail(report: ArticleReport): EmailMessage {
	const reasonLabel = report.reason === undefined ? "No type selected" : reportReasonLabel(report.reason);
	return {
		from: REPORT_FROM,
		to: REPORT_ADDRESS,
		...(report.reporter.kind === "anonymous" ? {} : { replyTo: report.reporter.email }),
		subject: `[User report] ${reasonLabel}: ${report.title}`,
		html: render(TEMPLATE, {
			articleUrl: report.articleUrl,
			title: report.title,
			reasonLabel,
			details: report.details,
			reporterLine: reporterLine(report.reporter),
		}),
	};
}
