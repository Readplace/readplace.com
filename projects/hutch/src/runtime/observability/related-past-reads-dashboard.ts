import assert from "node:assert";
import {
	EXPERIMENT_RESULT_STREAM,
	RELATED_PAST_READS_EXPERIMENT,
} from "@packages/hutch-infra-components";
import { NEXT_READ_TRACKING } from "../web/shared/next-read/next-read.tracking";
import { ANALYTICS_EVENTS, STREAMS } from "./events";
import type { DashboardBody, DashboardWidget } from "./analytics-dashboard";

export interface BuildRelatedPastReadsDashboardDeps {
	region: string;
	analyticsLogGroupName: string;
	excludedVisitorHashes: readonly string[];
}

function sourceClause(logGroupNames: readonly string[]): string {
	assert(logGroupNames.length > 0, "sourceClause requires at least one log group name");
	return logGroupNames.map((n) => `SOURCE '${n}'`).join(" | ");
}

function excludeVisitorHashesClause(excludedVisitorHashes: readonly string[]): string[] {
	if (excludedVisitorHashes.length === 0) return [];
	const list = excludedVisitorHashes.map((h) => `"${h}"`).join(", ");
	return [`| filter (not ispresent(visitor_hash)) or (visitor_hash not in [${list}])`];
}

function logWidget(params: {
	region: string;
	title: string;
	logGroupNames: readonly string[];
	query: string;
	x: number;
	y: number;
	width: number;
	height: number;
	view: "pie" | "table" | "bar" | "timeSeries";
}): DashboardWidget {
	return {
		type: "log",
		x: params.x,
		y: params.y,
		width: params.width,
		height: params.height,
		properties: {
			region: params.region,
			title: params.title,
			query: `${sourceClause(params.logGroupNames)} | ${params.query}`,
			view: params.view,
		},
	};
}

function textWidget(params: {
	markdown: string;
	x: number;
	y: number;
	width: number;
	height: number;
}): DashboardWidget {
	return {
		type: "text",
		x: params.x,
		y: params.y,
		width: params.width,
		height: params.height,
		properties: { markdown: params.markdown },
	};
}

const CARD_ELEMENTS = [
	NEXT_READ_TRACKING.unread.clickContent,
	NEXT_READ_TRACKING.read.clickContent,
	NEXT_READ_TRACKING.unread.dismissContent,
	NEXT_READ_TRACKING.read.dismissContent,
] as const;

function elementList(): string {
	return CARD_ELEMENTS.map((element) => `"${element}"`).join(", ");
}

export function buildRelatedPastReadsDashboardBody(
	deps: BuildRelatedPastReadsDashboardDeps,
): DashboardBody {
	const { region, analyticsLogGroupName, excludedVisitorHashes } = deps;
	const exclude = excludeVisitorHashesClause(excludedVisitorHashes);
	const analyticsSource = [analyticsLogGroupName];
	const widgets: DashboardWidget[] = [];

	widgets.push(
		textWidget({
			markdown: [
				"## Similar past reads",
				"",
				`The reader's end-of-article card. An **unread** pick (\`${NEXT_READ_TRACKING.unread.clickContent}\`) is the product goal; a **past read** (\`${NEXT_READ_TRACKING.read.clickContent}\`) is the fallback shown only when no stored pick is still unread.`,
				"",
				"The top row is the shipped feature. The bottom row is the offline prompt-arm experiment that chose how candidates are gathered, written by the arm harness when it is run with publishing enabled.",
			].join("\n"),
			x: 0,
			y: 0,
			width: 24,
			height: 4,
		}),
	);

	// --- Shipped feature ---
	// The card carries utm_medium=internal, so the analytics middleware emits a
	// `click` event for every open and every dismissal without a beacon. The two
	// card modes are distinguishable because the pick's read state selects the
	// utm_content element.

	widgets.push(
		logWidget({
			region,
			title: "Next-read card clicks per day (unread pick vs past read)",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, utm_content",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.click}"`,
				`| filter utm_content in [${elementList()}]`,
				...exclude,
				"| stats count(*) as clicks by bin(1d), utm_content",
			].join(" "),
			x: 0,
			y: 4,
			width: 12,
			height: 8,
			view: "timeSeries",
		}),
		logWidget({
			region,
			title: "Next-read card engagement by element (opens vs dismissals)",
			logGroupNames: analyticsSource,
			query: [
				"fields utm_content",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.click}"`,
				`| filter utm_content in [${elementList()}]`,
				...exclude,
				"| stats count(*) as clicks by utm_content",
				"| sort clicks desc",
			].join(" "),
			x: 12,
			y: 4,
			width: 12,
			height: 8,
			view: "bar",
		}),
		logWidget({
			region,
			title: "Distinct readers opening a past read per day",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, visitor_id",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.click}"`,
				`| filter utm_content = "${NEXT_READ_TRACKING.read.clickContent}"`,
				"| filter ispresent(visitor_id)",
				...exclude,
				"| stats count_distinct(visitor_id) as readers by bin(1d)",
			].join(" "),
			x: 0,
			y: 12,
			width: 12,
			height: 8,
			view: "timeSeries",
		}),
		logWidget({
			region,
			title: "Which source article sent the reader onward (utm_term)",
			logGroupNames: analyticsSource,
			query: [
				"fields utm_term, utm_content",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.click}"`,
				`| filter utm_content in ["${NEXT_READ_TRACKING.unread.clickContent}", "${NEXT_READ_TRACKING.read.clickContent}"]`,
				"| filter ispresent(utm_term)",
				...exclude,
				"| stats count(*) as opens by utm_term, utm_content",
				"| sort opens desc",
				"| limit 25",
			].join(" "),
			x: 12,
			y: 12,
			width: 12,
			height: 8,
			view: "table",
		}),
	);

	// --- Offline prompt-arm experiment ---
	// Each harness run publishes one arm-result line per arm per anchor, so the
	// arms stay comparable across runs rather than living in a local report file.

	const experimentFilter = `| filter stream = "${EXPERIMENT_RESULT_STREAM}" and event = "arm-result" and experiment = "${RELATED_PAST_READS_EXPERIMENT}"`;

	widgets.push(
		logWidget({
			region,
			title: "Experiment — picks per arm (unread vs past read)",
			logGroupNames: analyticsSource,
			query: [
				"fields arm, unread_picks, read_picks",
				experimentFilter,
				"| stats sum(unread_picks) as unread_picks, sum(read_picks) as read_picks by arm",
				"| sort arm asc",
			].join(" "),
			x: 0,
			y: 20,
			width: 12,
			height: 8,
			view: "bar",
		}),
		logWidget({
			region,
			title: "Experiment — cost and latency per arm",
			logGroupNames: analyticsSource,
			query: [
				"fields arm, input_tokens, output_tokens, latency_ms",
				experimentFilter,
				"| stats sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens, avg(latency_ms) as avg_latency_ms, max(latency_ms) as max_latency_ms, sum(over_production_timeout) as over_timeout by arm",
				"| sort arm asc",
			].join(" "),
			x: 12,
			y: 20,
			width: 12,
			height: 8,
			view: "table",
		}),
		logWidget({
			region,
			title: "Experiment — picks per arm over successive runs",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, arm, picks",
				experimentFilter,
				"| stats avg(picks) as avg_picks by bin(1d), arm",
			].join(" "),
			x: 0,
			y: 28,
			width: 12,
			height: 8,
			view: "timeSeries",
		}),
		logWidget({
			region,
			title: "Experiment — every arm result (newest first)",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, run_id, arm, anchor_url, repeat, picks, unread_picks, read_picks, unread_pool, read_pool, input_tokens, output_tokens, latency_ms, over_production_timeout, failed",
				experimentFilter,
				"| sort @timestamp desc",
				"| limit 100",
			].join(" "),
			x: 12,
			y: 28,
			width: 12,
			height: 8,
			view: "table",
		}),
	);

	return { widgets };
}
