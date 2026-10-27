import type { DashboardWidget } from "./analytics-dashboard";
import { DEEPSEEK_COST_METRIC } from "./metric-filters";

const DEEPSEEK_FEATURE_LABELS = {
	summary: "Summary",
	next_read: "Next Read",
	past_reads: "Past Reads",
	readlist_purpose_filter: "Readlist Purpose Filter",
	newsletter_link_triage: "Newsletter Link Triage",
	content_selection: "Content Selection",
	pdf_extraction: "PDF Extraction",
} as const;

const DEEPSEEK_COST_WIDGET_TITLE =
	"DeepSeek cost by feature — USD per day, legend totals follow the selected range (CloudWatch metric since 2026-10-27, internal usage included)";

export function deepseekCostWidget(params: { region: string; y: number }): DashboardWidget {
	return {
		type: "metric",
		x: 0,
		y: params.y,
		width: 24,
		height: 8,
		properties: {
			region: params.region,
			title: DEEPSEEK_COST_WIDGET_TITLE,
			metrics: Object.entries(DEEPSEEK_FEATURE_LABELS).map(([feature, label]) => [
				DEEPSEEK_COST_METRIC.namespace,
				DEEPSEEK_COST_METRIC.name,
				DEEPSEEK_COST_METRIC.dimension,
				feature,
				{ label: `${label} — USD \${SUM}`, stat: "Sum" },
			]),
			period: 86400,
			stat: "Sum",
			view: "timeSeries",
			stacked: false,
			legend: { position: "bottom" },
			yAxis: { left: { label: "USD", showUnits: false, min: 0 } },
		},
	};
}
