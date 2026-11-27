import assert from "node:assert";
import type { LogWidgetSpec } from "./log-widget-spec.types";

export interface DashboardWidget {
	type: string;
	x: number;
	y: number;
	width: number;
	height: number;
	properties: Record<string, unknown>;
}

/**
 * Dashboard log widgets prepend each log group with its own `SOURCE` keyword
 * and join them with `|`. The `logGroups(namePrefix: [...])` function exists
 * only for the start-query CLI/API and the dashboard renderer rejects it with
 * `Invalid NamePrefix: "namePrefix: ["`.
 */
function sourceClause(logGroupNames: readonly string[]): string {
	assert(logGroupNames.length > 0, "sourceClause requires at least one log group name");
	return logGroupNames.map((n) => `SOURCE '${n}'`).join(" | ");
}

export function logWidget(
	params: LogWidgetSpec & { x: number; y: number; width: number; height: number; region: string },
): DashboardWidget {
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
