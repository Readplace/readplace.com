import assert from "node:assert";
import type { LogsInsightsRow } from "@packages/provider-contracts/logs-insights";
import { toAbsoluteDate, toAbsoluteDateTime } from "@packages/web-shell";

const BIN_FIELD = /^bin\(\d+(ms|s|m|h|d|w|mo|q|y)\)$/;
const STATS_STAGE = /^\s*stats\s/;
const GROUP_BY = /\sby\s+/;
const KEY_ALIAS = /\s+as\s+(\S+)$/;
const QUOTES = new Set(['"', "'", "`"]);
const REGEX_CAN_START = /(^|[(,=~!]|\blike)\s*$/;
const SERIES_SEPARATOR = " · ";
const MISSING_SERIES_VALUE = "—";

const WIDTH = 320;
const HEIGHT = 140;
const PLOT_LEFT = 48;
const PLOT_RIGHT = WIDTH - 12;
const PLOT_TOP = 10;
const PLOT_BOTTOM = HEIGHT - 26;
const X_LABEL_BASELINE = HEIGHT - 8;

export interface ChartFrame {
	viewBox: string;
	gridLines: { x1: number; x2: number; y: number }[];
	yLabels: { x: number; y: number; label: string }[];
	xLabels: { x: number; y: number; label: string; anchor: "start" | "end" }[];
}

export interface SmallMultiple {
	title: string;
	line: string;
	points: { cx: number; cy: number; title: string }[];
}

export interface SmallMultiples {
	frame: ChartFrame;
	multiples: SmallMultiple[];
}

function binTime(value: string | undefined): number {
	assert(value, "every time-series row must carry its bin() value");
	const time = Date.parse(`${value.replace(" ", "T")}Z`);
	assert(Number.isFinite(time), `Logs Insights bin value must be a UTC timestamp (got: ${value})`);
	return time;
}

function niceCeiling(value: number): number {
	const magnitude = 10 ** Math.floor(Math.log10(value));
	const step = [1, 2, 5, 10].find((multiplier) => multiplier * magnitude >= value);
	assert(step, "a ceiling step always exists within one order of magnitude");
	return step * magnitude;
}

function formatValue(value: number): string {
	return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function round(value: number): number {
	return Math.round(value * 10) / 10;
}

function maskNested(text: string): string {
	let masked = "";
	let closer: string | undefined;
	let escaped = false;
	let depth = 0;
	for (const [index, char] of [...text].entries()) {
		if (closer !== undefined) {
			if (!escaped && char === closer) closer = undefined;
			escaped = !escaped && char === "\\";
			masked += "_";
			continue;
		}
		if (QUOTES.has(char) || (char === "/" && REGEX_CAN_START.test(text.slice(0, index)))) closer = char;
		if (char === "(") depth++;
		if (char === ")") depth--;
		masked += depth > 0 ? "_" : char;
	}
	return masked;
}

function splitTopLevel(text: string, separator: "|" | ","): string[] {
	const masked = maskNested(text);
	const parts: string[] = [];
	let from = 0;
	for (let index = masked.indexOf(separator); index !== -1; index = masked.indexOf(separator, index + 1)) {
		parts.push(text.slice(from, index));
		from = index + 1;
	}
	parts.push(text.slice(from));
	return parts;
}

function groupKeys(query: string): { field: string; isBin: boolean }[] {
	const stats = splitTopLevel(query, "|").filter((stage) => STATS_STAGE.test(stage)).at(-1);
	assert(stats, `a time-series widget's query must aggregate with stats (got: ${query})`);
	const groupBy = GROUP_BY.exec(maskNested(stats));
	assert(groupBy, `a time-series widget's stats must group by bin() (got: ${stats.trim()})`);
	return splitTopLevel(stats.slice(groupBy.index + groupBy[0].length), ",").map((key) => {
		const expression = key.trim();
		const alias = KEY_ALIAS.exec(maskNested(expression));
		if (!alias) return { field: expression, isBin: BIN_FIELD.test(expression) };
		return {
			field: expression.slice(alias.index + alias[0].length - alias[1].length),
			isBin: BIN_FIELD.test(expression.slice(0, alias.index)),
		};
	});
}

export function buildSmallMultiples(input: {
	query: string;
	rows: readonly LogsInsightsRow[];
	startTime: Date;
	endTime: Date;
}): SmallMultiples {
	const records = input.rows.map((row) => new Map(row.map((cell) => [cell.field, cell.value])));
	const fields = [...new Set(input.rows.flatMap((row) => row.map((cell) => cell.field)))];
	const keys = groupKeys(input.query);
	const xKey = keys.find((key) => key.isBin);
	assert(xKey, `a time-series widget's stats must group by bin() (got: ${keys.map((key) => key.field).join(", ")})`);
	const xField = xKey.field;
	const keyFields = keys.map((key) => key.field);
	const seriesFields = keyFields.filter((field) => field !== xField);
	const valueFields = fields.filter((field) => !keyFields.includes(field));

	const series = new Map<string, { title: string; points: { time: number; value: number }[] }>();
	const binned = records.map((record) => ({ record, time: binTime(record.get(xField)) }));
	for (const { record, time } of binned) {
		const seriesKey = seriesFields.map((field) => record.get(field) ?? MISSING_SERIES_VALUE).join(SERIES_SEPARATOR);
		for (const valueField of valueFields) {
			const value = record.get(valueField);
			if (value === undefined) continue;
			const title = seriesKey === "" ? valueField : `${seriesKey}${SERIES_SEPARATOR}${valueField}`;
			const multiple = series.get(title) ?? { title, points: [] };
			multiple.points.push({ time, value: Number(value) });
			series.set(title, multiple);
		}
	}

	const largest = Math.max(1, ...[...series.values()].flatMap((multiple) => multiple.points.map((point) => point.value)));
	const yMax = niceCeiling(largest);
	const start = Math.min(input.startTime.getTime(), ...binned.map((entry) => entry.time));
	const span = input.endTime.getTime() - start;
	const x = (time: number) => round(PLOT_LEFT + ((time - start) / span) * (PLOT_RIGHT - PLOT_LEFT));
	const y = (value: number) => round(PLOT_BOTTOM - (value / yMax) * (PLOT_BOTTOM - PLOT_TOP));

	const yTicks = [0, yMax / 2, yMax];

	return {
		frame: {
			viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
			gridLines: yTicks.map((value) => ({ x1: PLOT_LEFT, x2: PLOT_RIGHT, y: y(value) })),
			yLabels: yTicks.map((value) => ({ x: PLOT_LEFT - 6, y: y(value), label: formatValue(value) })),
			xLabels: [
				{ x: PLOT_LEFT, y: X_LABEL_BASELINE, label: toAbsoluteDate({ iso: new Date(start).toISOString() }).label, anchor: "start" },
				{ x: PLOT_RIGHT, y: X_LABEL_BASELINE, label: toAbsoluteDate({ iso: input.endTime.toISOString() }).label, anchor: "end" },
			],
		},
		multiples: [...series.values()].map((multiple) => {
			const points = [...multiple.points]
				.sort((a, b) => a.time - b.time)
				.map((point) => ({
					cx: x(point.time),
					cy: y(point.value),
					title: `${formatValue(point.value)} at ${toAbsoluteDateTime({ iso: new Date(point.time).toISOString() }).label}`,
				}));
			return {
				title: multiple.title,
				line: points.map((point) => `${point.cx},${point.cy}`).join(" "),
				points,
			};
		}),
	};
}
