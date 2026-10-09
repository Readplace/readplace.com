import type { CanaryReportRow } from "@packages/provider-contracts/canary-report";
import type { StuckRow } from "./collect-stuck-rows";

function countByName(names: readonly string[]): [string, number][] {
	const counts = new Map<string, number>();
	for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
	return Array.from(counts).sort(([nameA, countA], [nameB, countB]) => countB - countA || (nameA < nameB ? -1 : 1));
}

export function toCanaryReportRow(row: StuckRow): CanaryReportRow {
	return {
		url: row.originalUrl,
		labels: row.reasons,
		detail: row.terminalCheckMessage,
		savedAt: undefined,
		contentFetchedAt: row.contentFetchedAt,
	};
}

export function formatStuckArticlesIssue(input: {
	rows: readonly [StuckRow, ...StuckRow[]];
	runUrl: string;
	reportUrl: string;
	today: string;
}): { rowCount: number; body: string } {
	const byReason = countByName(input.rows.flatMap((row) => row.reasons));
	const body = [
		"<!-- CLAUDE_STUCK_ARTICLES_FIX -->",
		"",
		"The stuck-articles canary failed on its scheduled run. The rows on the report never reached a terminal-good state and their URLs still resolve. Investigate the root cause, then close this issue once resolved.",
		"",
		"Each row's URL, state and recrawl button are on the report page, which only admins can open. Do not copy a reader's URL into this issue, a comment or a commit; cite a row by its number on the report.",
		"",
		"## Context",
		`- **Run**: ${input.runUrl}`,
		`- **Date (UTC)**: ${input.today}`,
		`- **Stuck rows**: ${input.rows.length}`,
		`- **Report (admins only)**: ${input.reportUrl}`,
		"",
		"## Breakdown by reason",
		...byReason.map(([reason, count]) => `- **${reason}**: ${count}`),
	].join("\n");
	return { rowCount: input.rows.length, body };
}
