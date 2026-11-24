import type { AdminDashboardSlug, LogWidgetSpec } from "@packages/dashboard-widgets";
import type { LogsInsightsRow } from "@packages/provider-contracts/logs-insights";
import type { DashboardRange } from "./admin-dashboards.url";

export interface DashboardWidgetResult {
	spec: LogWidgetSpec;
	rows: readonly LogsInsightsRow[];
}

export interface DashboardView {
	slug: AdminDashboardSlug;
	range: DashboardRange;
	endTime: Date;
}

export type FindDashboardResults = (view: DashboardView) => readonly DashboardWidgetResult[] | undefined;

export type KeepDashboardResults = (kept: { view: DashboardView; results: readonly DashboardWidgetResult[] }) => void;

function entryKey(view: DashboardView): string {
	return `${view.slug}|${view.range}`;
}

export function initAdminDashboardResults(): {
	findDashboardResults: FindDashboardResults;
	keepDashboardResults: KeepDashboardResults;
} {
	let generation: { endMs: number; entries: Map<string, readonly DashboardWidgetResult[]> } = {
		endMs: Number.NaN,
		entries: new Map(),
	};

	const findDashboardResults: FindDashboardResults = (view) => {
		if (generation.endMs !== view.endTime.getTime()) return undefined;
		return generation.entries.get(entryKey(view));
	};

	const keepDashboardResults: KeepDashboardResults = ({ view, results }) => {
		const endMs = view.endTime.getTime();
		if (generation.endMs !== endMs) {
			generation = { endMs, entries: new Map() };
		}
		generation.entries.set(entryKey(view), results);
	};

	return { findDashboardResults, keepDashboardResults };
}
