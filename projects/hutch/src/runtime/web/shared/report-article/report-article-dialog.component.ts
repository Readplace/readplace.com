import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReader } from "@packages/translations/hutch-reader";
import { CLICK_SURFACES, render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

const { t } = translator(hutchReader, DEFAULT_LOCALE);

const FORM_TEMPLATE = readFileSync(join(__dirname, "report-article-form.template.html"), "utf-8");
const SENT_TEMPLATE = readFileSync(join(__dirname, "report-article-sent.template.html"), "utf-8");

export const REPORT_ARTICLE_STYLES = readFileSync(join(__dirname, "report-article.styles.css"), "utf-8");
export const REPORT_ARTICLE_SCRIPT = `<script src="/client-dist/report-article.client.js" defer></script>`;

export const REPORT_ARTICLE_POPOVER_ID = "report-article";
export const REPORT_ARTICLE_PATH = "/report-article";
export const REPORT_ARTICLE_OPENED_PATH = "/report-article/opened";
export const REPORT_ARTICLE_TRACKING_SOURCE = "article-report";
export const REPORT_DETAILS_MAX_LENGTH = 5000;

export const REPORT_REASONS = [
	"bad-summary",
	"wrong-information",
	"spam-abuse",
	"illegal-content",
	"other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_SURFACES = ["reader", CLICK_SURFACES.readerPublic] as const;
export type ReportSurface = (typeof REPORT_SURFACES)[number];

export function reportReasonLabel(reason: ReportReason): string {
	switch (reason) {
		case "bad-summary":
			return t("articleBody.report.reason.badSummary");
		case "wrong-information":
			return t("articleBody.report.reason.wrongInformation");
		case "spam-abuse":
			return t("articleBody.report.reason.spamAbuse");
		case "illegal-content":
			return t("articleBody.report.reason.illegalContent");
		case "other":
			return t("articleBody.report.reason.other");
	}
}

export interface ReportArticleForm {
	viewUrl: string;
	title: string;
	surface: ReportSurface;
	asksForEmail: boolean;
	values: { reason?: ReportReason; details?: string; email?: string };
	failed: boolean;
}

function tracked(path: string, { surface, content }: { surface: ReportSurface; content: string }): string {
	return withInternalTracking(path, { source: REPORT_ARTICLE_TRACKING_SOURCE, content, term: surface });
}

export function renderReportArticleForm(form: ReportArticleForm): string {
	return render(FORM_TEMPLATE, {
		action: tracked(REPORT_ARTICLE_PATH, { surface: form.surface, content: "report-send" }),
		popoverId: REPORT_ARTICLE_POPOVER_ID,
		viewUrl: form.viewUrl,
		title: form.title,
		surface: form.surface,
		asksForEmail: form.asksForEmail,
		failed: form.failed,
		details: form.values.details,
		email: form.values.email,
		detailsMaxLength: REPORT_DETAILS_MAX_LENGTH,
		reasons: REPORT_REASONS.map((value) => ({
			value,
			label: reportReasonLabel(value),
			checked: value === form.values.reason,
		})),
	});
}

export function renderReportArticleSent(): string {
	return render(SENT_TEMPLATE, { popoverId: REPORT_ARTICLE_POPOVER_ID });
}

export interface ReportArticleDialogInput {
	viewUrl: string;
	title: string;
	surface: ReportSurface;
	asksForEmail: boolean;
}

export function renderReportArticleDialog(input: ReportArticleDialogInput): string {
	return renderConfirmPopover({
		id: REPORT_ARTICLE_POPOVER_ID,
		key: "report-article",
		title: t("articleBody.report.title"),
		body: t("articleBody.report.body"),
		openBeaconUrl: tracked(REPORT_ARTICLE_OPENED_PATH, { surface: input.surface, content: "report-open" }),
		close: {},
		actionsHtml: renderReportArticleForm({ ...input, values: {}, failed: false }),
	});
}
