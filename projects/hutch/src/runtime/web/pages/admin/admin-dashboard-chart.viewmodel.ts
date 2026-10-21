import assert from "node:assert";
import type { LogsInsightsRow } from "@packages/provider-contracts/logs-insights";
import { toAbsoluteDate, toAbsoluteDateTime } from "@packages/web-shell";

const BIN_FIELD = /^bin\(\d+(ms|s|m|h|d|w|mo|q|y)\)$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
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

export function buildSmallMultiples(input: {
	rows: readonly LogsInsightsRow[];
	startTime: Date;
	endTime: Date;
}): SmallMultiples {
	const records = input.rows.map((row) => new Map(row.map((cell) => [cell.field, cell.value])));
	const fields = [...new Set(input.rows.flatMap((row) => row.map((cell) => cell.field)))];
	const xField = fields.find((field) => BIN_FIELD.test(field));
	assert(xField, `a time-series widget's rows must carry a bin() field (got: ${fields.join(", ")})`);
	const others = fields.filter((field) => field !== xField);
	const isValueField = (field: string) =>
		records.every((record) => NUMBER.test(record.get(field) ?? "0"));
	const valueFields = others.filter(isValueField);
	const seriesFields = others.filter((field) => !isValueField(field));

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
