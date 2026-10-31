import { buildAnalyticsDashboardBody } from "./analytics-dashboard";
import { deepseekCostWidget } from "./deepseek-cost-widget";
import { ANALYTICS_LOG_GROUP, ERRORS_LOG_GROUP, LOG_GROUPS } from "./events";

describe("DeepSeek cost widget", () => {
	it("plots one Readplace/DeepSeek CostUsd row per feature, keyed by the feature dimension and labelled with the display text plus the range total CloudWatch fills in for ${SUM}, with no colour pinned to any row", () => {
		expect(deepseekCostWidget({ region: "ap-southeast-2", y: 230 }).properties.metrics).toEqual([
			["Readplace/DeepSeek", "CostUsd", "feature", "summary", { label: "Summary — USD ${SUM}", stat: "Sum" }],
			["Readplace/DeepSeek", "CostUsd", "feature", "next_read", { label: "Next Read — USD ${SUM}", stat: "Sum" }],
			["Readplace/DeepSeek", "CostUsd", "feature", "past_reads", { label: "Past Reads — USD ${SUM}", stat: "Sum" }],
			["Readplace/DeepSeek", "CostUsd", "feature", "readlist_purpose_filter", { label: "Readlist Purpose Filter — USD ${SUM}", stat: "Sum" }],
			["Readplace/DeepSeek", "CostUsd", "feature", "newsletter_link_triage", { label: "Newsletter Link Triage — USD ${SUM}", stat: "Sum" }],
			["Readplace/DeepSeek", "CostUsd", "feature", "content_selection", { label: "Content Selection — USD ${SUM}", stat: "Sum" }],
			["Readplace/DeepSeek", "CostUsd", "feature", "pdf_extraction", { label: "PDF Extraction — USD ${SUM}", stat: "Sum" }],
		]);
	});

	it("draws one full-width time series summed per UTC day, with the USD axis starting at zero and the legend under the plot, under a title that dates the series from its filter's first day, says only answered calls are counted and says internal usage is included, because a metric filter never backfills, the usage line is written only after DeepSeek answers, and a model call carries no identity to prune", () => {
		expect(deepseekCostWidget({ region: "ap-southeast-2", y: 230 })).toMatchObject({
			type: "metric",
			x: 0,
			y: 230,
			width: 24,
			height: 8,
			properties: {
				region: "ap-southeast-2",
				title: expect.stringMatching(
					/^DeepSeek cost by feature — USD per day, legend totals follow the selected range \(CloudWatch metric since \d{4}-\d{2}-\d{2}, answered calls only, internal usage included\)$/,
				),
				period: 86400,
				stat: "Sum",
				view: "timeSeries",
				stacked: false,
				legend: { position: "bottom" },
				yAxis: { left: { label: "USD", showUnits: false, min: 0 } },
			},
		});
	});

	it("is the one widget on the analytics dashboard that reads Readplace/DeepSeek, placed in the free full-width band at y 230", () => {
		const widgets = buildAnalyticsDashboardBody({
			region: "ap-southeast-2",
			hutchLogGroupName: LOG_GROUPS.hutchHandler,
			analyticsLogGroupName: ANALYTICS_LOG_GROUP,
			errorsLogGroupName: ERRORS_LOG_GROUP,
			excludedVisitorIds: ["11111111-1111-4111-8111-111111111111"],
			excludedUserIds: ["22222222222222222222222222222222"],
		}).widgets;
		const deepseekWidgets = widgets.filter(
			(w) =>
				w.type === "metric" &&
				Array.isArray(w.properties.metrics) &&
				w.properties.metrics.some((m) => Array.isArray(m) && m[0] === "Readplace/DeepSeek"),
		);
		expect(deepseekWidgets.map((w) => w.y)).toEqual([230]);
	});
});
