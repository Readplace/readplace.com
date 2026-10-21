import assert from "node:assert";
import type { LogsInsightsRow } from "@packages/provider-contracts/logs-insights";
import { toAbsoluteDateTime } from "@packages/web-shell";
import { ADMIN_DASHBOARD_SLUGS, type AdminDashboard, type AdminDashboardSlug } from "../../../observability/admin-dashboards";
import type { LogWidgetSpec } from "../../../observability/log-widget-spec.types";
import { buildSmallMultiples, type SmallMultiples } from "./admin-dashboard-chart.viewmodel";
import {
	adminDashboardPath,
	DASHBOARD_RANGE_KEYS,
	DASHBOARD_RANGES,
	type DashboardRange,
} from "./admin-dashboards.url";

export const ADMIN_DASHBOARD_SOURCE = "admin-dashboard";

export interface AdminHiddenField {
	name: string;
	value: string;
}

export interface AdminGetForm {
	method: "GET";
	action: string;
	fields: AdminHiddenField[];
}

export interface DashboardTableCell {
	label: string;
	text: string;
	numeric: boolean;
}

export interface DashboardTable {
	columns: string[];
	rows: { cells: DashboardTableCell[] }[];
}

export type DashboardWidgetBody =
	| { view: "table"; table: DashboardTable }
	| { view: "timeSeries"; chart: SmallMultiples; table: DashboardTable };

export interface DashboardWidgetViewModel {
	key: string;
	title: string;
	emptyText: string;
	emptyActions: { label: string; form: AdminGetForm }[];
	body: DashboardWidgetBody | undefined;
}

export interface AdminDashboardViewModel {
	slug: AdminDashboardSlug;
	title: string;
	description: string;
	windowLabel: string;
	ranges: { key: DashboardRange; label: string; ariaCurrent: "page" | "false"; form: AdminGetForm }[];
	widgets: DashboardWidgetViewModel[];
}

const ID_FIELD = /(^|_)id$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const MISSING_CELL = "—";

function trackedGetForm(input: { action: string; content: string; fields: AdminHiddenField[] }): AdminGetForm {
	return {
		method: "GET",
		action: input.action,
		fields: [
			...input.fields,
			{ name: "utm_source", value: ADMIN_DASHBOARD_SOURCE },
			{ name: "utm_medium", value: "internal" },
			{ name: "utm_content", value: input.content },
		],
	};
}

export function formatCell(cell: { field: string; value: string }): { text: string; numeric: boolean } {
	if (ID_FIELD.test(cell.field) || !NUMBER.test(cell.value)) return { text: cell.value, numeric: false };
	return { text: Number(cell.value).toLocaleString("en-US", { maximumFractionDigits: 4 }), numeric: true };
}

export function buildDashboardTable(rows: readonly LogsInsightsRow[]): DashboardTable {
	const records = rows.map((row) => new Map(row.map((cell) => [cell.field, cell.value])));
	const columns = [...new Set(rows.flatMap((row) => row.map((cell) => cell.field)))];
	return {
		columns,
		rows: records.map((record) => ({
			cells: columns.map((column) => {
				const value = record.get(column);
				const formatted =
					value === undefined ? { text: MISSING_CELL, numeric: false } : formatCell({ field: column, value });
				return { label: column, ...formatted };
			}),
		})),
	};
}

const WIDGET_BODIES: Partial<
	Record<
		LogWidgetSpec["view"],
		(input: { rows: readonly LogsInsightsRow[]; startTime: Date; endTime: Date }) => DashboardWidgetBody
	>
> = {
	table: ({ rows }) => ({ view: "table", table: buildDashboardTable(rows) }),
	timeSeries: (input) => ({
		view: "timeSeries",
		chart: buildSmallMultiples(input),
		table: buildDashboardTable(input.rows),
	}),
};

function widgetBody(input: {
	spec: LogWidgetSpec;
	rows: readonly LogsInsightsRow[];
	startTime: Date;
	endTime: Date;
}): DashboardWidgetBody {
	const build = WIDGET_BODIES[input.spec.view];
	assert(build, `No admin renderer for a ${input.spec.view} widget (${input.spec.title})`);
	return build(input);
}

function nextRange(range: DashboardRange): DashboardRange[] {
	const index = DASHBOARD_RANGE_KEYS.indexOf(range);
	return DASHBOARD_RANGE_KEYS.slice(index + 1, index + 2);
}

function rangePhrase(range: DashboardRange): string {
	return `the ${DASHBOARD_RANGES[range].label.toLowerCase()}`;
}

export function buildAdminDashboardViewModel(input: {
	slug: AdminDashboardSlug;
	dashboard: Pick<AdminDashboard, "title" | "description">;
	range: DashboardRange;
	startTime: Date;
	endTime: Date;
	widgets: readonly { spec: LogWidgetSpec; rows: readonly LogsInsightsRow[] }[];
}): AdminDashboardViewModel {
	const action = adminDashboardPath(input.slug);
	return {
		slug: input.slug,
		title: input.dashboard.title,
		description: input.dashboard.description,
		windowLabel: `${toAbsoluteDateTime({ iso: input.startTime.toISOString() }).label} – ${toAbsoluteDateTime({ iso: input.endTime.toISOString() }).label}`,
		ranges: DASHBOARD_RANGE_KEYS.map((key) => ({
			key,
			label: DASHBOARD_RANGES[key].label,
			ariaCurrent: key === input.range ? "page" : "false",
			form: trackedGetForm({ action, content: `range-${key}`, fields: [{ name: "range", value: key }] }),
		})),
		widgets: input.widgets.map(({ spec, rows }, index) => ({
			key: String(index + 1),
			title: spec.title,
			emptyText: `No matching events in ${rangePhrase(input.range)}`,
			emptyActions: nextRange(input.range).map((key) => ({
				label: `Try ${rangePhrase(key)}`,
				form: trackedGetForm({ action, content: `empty-range-${key}`, fields: [{ name: "range", value: key }] }),
			})),
			body: rows.length === 0 ? undefined : widgetBody({ spec, rows, startTime: input.startTime, endTime: input.endTime }),
		})),
	};
}

export interface AdminDashboardsIndexViewModel {
	dashboards: { slug: AdminDashboardSlug; title: string; description: string; form: AdminGetForm }[];
}

export function buildAdminDashboardsIndexViewModel(
	dashboards: Record<AdminDashboardSlug, Pick<AdminDashboard, "title" | "description">>,
): AdminDashboardsIndexViewModel {
	return {
		dashboards: ADMIN_DASHBOARD_SLUGS.map((slug) => ({
			slug,
			title: dashboards[slug].title,
			description: dashboards[slug].description,
			form: trackedGetForm({ action: adminDashboardPath(slug), content: slug, fields: [] }),
		})),
	};
}
