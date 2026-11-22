import { z } from "zod";
import { ADMIN_DASHBOARD_SLUGS, type AdminDashboardSlug } from "@packages/dashboard-widgets";

export const ADMIN_DASHBOARDS_PATH = "/admin/dashboards";

export const AdminDashboardSlugSchema = z.enum(ADMIN_DASHBOARD_SLUGS);

const DAY_MS = 86_400_000;

const DASHBOARD_WINDOW_STEP_MS = 600_000;

export const DASHBOARD_RANGE_KEYS = ["1d", "7d", "30d", "90d"] as const;

export type DashboardRange = (typeof DASHBOARD_RANGE_KEYS)[number];

export const DASHBOARD_RANGES: Record<DashboardRange, { days: number; label: string }> = {
	"1d": { days: 1, label: "Last day" },
	"7d": { days: 7, label: "Last 7 days" },
	"30d": { days: 30, label: "Last 30 days" },
	"90d": { days: 90, label: "Last 90 days" },
};

const DashboardRangeSchema = z.object({ range: z.enum(DASHBOARD_RANGE_KEYS).catch("7d") });

export function parseDashboardRange(query: unknown): DashboardRange {
	return DashboardRangeSchema.parse(query).range;
}

export function dashboardWindow(input: { range: DashboardRange; now: Date }): { startTime: Date; endTime: Date } {
	const endMs = Math.floor(input.now.getTime() / DASHBOARD_WINDOW_STEP_MS) * DASHBOARD_WINDOW_STEP_MS;
	return { startTime: new Date(endMs - DASHBOARD_RANGES[input.range].days * DAY_MS), endTime: new Date(endMs) };
}

export function adminDashboardPath(slug: AdminDashboardSlug): string {
	return `${ADMIN_DASHBOARDS_PATH}/${slug}`;
}
