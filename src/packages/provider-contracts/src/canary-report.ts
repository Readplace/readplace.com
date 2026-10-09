import { z } from "zod";

export const CanaryNameSchema = z.enum(["failed-articles", "stuck-articles"]);
export type CanaryName = z.infer<typeof CanaryNameSchema>;

export const CanaryReportSourceSchema = z
	.string()
	.regex(/^(?:run-\d+-\d+|issue-\d+(?:-comment-\d+)?)$/)
	.brand<"CanaryReportSource">();
export type CanaryReportSource = z.infer<typeof CanaryReportSourceSchema>;

export interface CanaryReportKey {
	canary: CanaryName;
	source: CanaryReportSource;
}

export interface CanaryReportRow {
	url: string;
	labels: readonly string[];
	detail: string;
	savedAt: string | undefined;
	contentFetchedAt: string | undefined;
}

export interface CanaryReport extends CanaryReportKey {
	runUrl: string;
	createdAt: string;
	rows: readonly [CanaryReportRow, ...CanaryReportRow[]];
}

export type SaveCanaryReport = (report: CanaryReport) => Promise<void>;

export type FindCanaryReport = (key: CanaryReportKey) => Promise<CanaryReport | undefined>;

export const CANARY_REPORTS_PATH = "/admin/canary-reports";

export function canaryReportPath(key: CanaryReportKey): string {
	return `${CANARY_REPORTS_PATH}/${key.canary}/${key.source}`;
}
