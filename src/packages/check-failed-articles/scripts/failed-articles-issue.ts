import { parseCrawlFailureReason, SummaryFailureReasonSchema } from "@packages/article-state-types";
import type { CanaryReportRow } from "@packages/provider-contracts/canary-report";
import type { FailedAxis, FailedRow } from "./collect-failed-rows";

const HISTORY_GROUP_LABELS = {
	"readlist-loaded-no-reader-open": "Readlist loaded, no reader open recorded",
	"reader-opened-before-failure": "Reader opened before failure",
	"other-unknown": "Other or unknown history",
};

const READER_ROUTE_LABELS = {
	"signed-in": "Signed-in reader opened before failure",
	public: "Public reader open recorded before failure",
};

export type FailedArticleHistoryGroup = keyof typeof HISTORY_GROUP_LABELS;
type RecordedReaderRoutes = readonly ["signed-in"] | readonly ["public"] | readonly ["signed-in", "public"];
export type FailedArticlesIssueRow = FailedRow & (
	| { historyGroup: "reader-opened-before-failure"; readerRoutes: RecordedReaderRoutes }
	| { historyGroup: Exclude<FailedArticleHistoryGroup, "reader-opened-before-failure">; readerRoutes?: never }
);

function crawlReasonKey(raw: string | undefined): string {
	if (raw === undefined) return "no stored reason";
	const reason = parseCrawlFailureReason(raw);
	if (reason === undefined) return "unrecognised reason";
	if (reason.kind === "blocked") return `blocked (${reason.cause})`;
	if ("httpStatus" in reason && reason.httpStatus !== undefined) return `${reason.kind} (HTTP ${reason.httpStatus})`;
	return reason.kind;
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function summaryReasonKey(raw: string | undefined): string {
	if (raw === undefined) return "no stored reason";
	const reason = SummaryFailureReasonSchema.safeParse(parseJson(raw));
	return reason.success ? reason.data.kind : "unrecognised reason";
}

const REASON_KEYS: Record<FailedAxis, (raw: string | undefined) => string> = {
	"crawl-failed": crawlReasonKey,
	"summary-failed": summaryReasonKey,
};

function countByName(names: readonly string[]): [string, number][] {
	const counts = new Map<string, number>();
	for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
	return Array.from(counts).sort(([nameA, countA], [nameB, countB]) => countB - countA || (nameA < nameB ? -1 : 1));
}

export function toCanaryReportRow(row: FailedRow & Partial<Pick<FailedArticlesIssueRow, "historyGroup" | "readerRoutes">>): CanaryReportRow {
	const reasons = row.axes.flatMap((axis) => {
		const raw = row.reasons[axis];
		return raw === undefined ? [] : [`${axis}: ${raw}`];
	});
	return {
		url: row.originalUrl,
		labels: [
			...row.axes,
			...(row.historyGroup === undefined ? [] : [HISTORY_GROUP_LABELS[row.historyGroup]]),
			...(row.readerRoutes?.map((route) => READER_ROUTE_LABELS[route]) ?? []),
		],
		detail: reasons.length === 0 ? "(no stored reason)" : reasons.join(" | "),
		savedAt: row.savedAt,
		contentFetchedAt: row.contentFetchedAt,
	};
}

export function formatFailedArticlesIssue(input: {
	rows: readonly [FailedArticlesIssueRow, ...FailedArticlesIssueRow[]];
	runUrl: string;
	reportUrl: string;
	today: string;
	historyEvidenceIncomplete?: boolean;
}): { rowCount: number; body: string } {
	const byAxis = countByName(input.rows.flatMap((row) => row.axes));
	const byReason = countByName(
		input.rows.flatMap((row) => row.axes.map((axis) => `${axis}: ${REASON_KEYS[axis](row.reasons[axis])}`)),
	);
	const byHistory = Object.entries(HISTORY_GROUP_LABELS).flatMap(([group, label]) => {
		const rows = input.rows.filter((row) => row.historyGroup === group);
		const lines = [`- **${label}**: ${rows.length}`];
		if (group === "reader-opened-before-failure") {
			lines.push(
				`  - **Signed-in reader recorded**: ${rows.filter((row) => row.readerRoutes?.some((route) => route === "signed-in")).length}`,
				`  - **Public reader recorded**: ${rows.filter((row) => row.readerRoutes?.some((route) => route === "public")).length}`,
				`  - **Both recorded**: ${rows.filter((row) => row.readerRoutes?.length === 2).length}`,
			);
		}
		return lines;
	});
	const body = [
		"<!-- CLAUDE_FAILED_ARTICLES_FIX -->",
		"",
		"The failed-articles canary surfaced user-visible failures after full processing was requested for the latest attempt. This is a debug worklist: investigate each cluster below, then close this issue once the backlog is processed (the canary skips its scan while this issue stays open).",
		"",
		"Each row's URL, stored reason and recrawl button are on the report page, which only admins can open. Do not copy a reader's URL into this issue, a comment or a commit; cite a row by its number on the report.",
		"",
		"## Context",
		`- **Run**: ${input.runUrl}`,
		`- **Date (UTC)**: ${input.today}`,
		`- **Failed rows**: ${input.rows.length}`,
		`- **Report (admins only)**: ${input.reportUrl}`,
		"",
		"## Breakdown by recorded access",
		...byHistory,
		"",
		...(input.historyEvidenceIncomplete ? [
			"Some access history could not be verified. Inconclusive rows are counted under Other or unknown history.",
			"",
		] : []),
		"The reader-open group counts opens recorded before the latest processing admission and signed-in reader requests that triggered it.",
		"An article can count under both confirmed routes. A zero means no open was confirmed in the available records.",
		"",
		"Among these reader routes, local HTML capture can start only from the signed-in reader on supported clients. Confirming an upload requires separate evidence.",
		"",
		"## Breakdown by axis",
		...byAxis.map(([axis, count]) => `- **${axis}**: ${count}`),
		"",
		"## Breakdown by reason",
		...byReason.map(([reason, count]) => `- **${reason}**: ${count}`),
	].join("\n");
	return { rowCount: input.rows.length, body };
}
