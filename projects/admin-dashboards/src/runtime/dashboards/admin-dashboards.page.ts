import assert from "node:assert";
import type { Request, Router } from "express";
import express from "express";
import { type BannerState, type RenderBase, sendComponent } from "@packages/web-shell";
import type {
	ExcludedIdentities,
	ReadExcludedIdentities,
	RunLogsInsightsQuery,
} from "@packages/provider-contracts/logs-insights";
import type { AdminDashboard, AdminDashboardSlug } from "@packages/dashboard-widgets";
import { AdminDashboardPage, AdminDashboardsIndexPage } from "./admin-dashboard.component";
import type {
	DashboardView,
	DashboardWidgetResult,
	FindDashboardResults,
	KeepDashboardResults,
} from "./admin-dashboard-results";
import { buildAdminDashboardViewModel, buildAdminDashboardsIndexViewModel } from "./admin-dashboard.viewmodel";
import { AdminDashboardSlugSchema, dashboardWindow, parseDashboardRange } from "./admin-dashboards.url";

export interface AdminDashboardsDependencies {
	base: RenderBase;
	bannerStateFor: (req: Request) => Promise<BannerState>;
	dashboards: Record<AdminDashboardSlug, AdminDashboard>;
	runLogsInsightsQuery: RunLogsInsightsQuery;
	readExcludedIdentities: ReadExcludedIdentities;
	now: () => Date;
	findDashboardResults: FindDashboardResults;
	keepDashboardResults: KeepDashboardResults;
}

const NO_EXCLUSIONS: ExcludedIdentities = { excludedVisitorIds: [], excludedUserIds: [] };

export function initAdminDashboardsRoutes(deps: AdminDashboardsDependencies): Router {
	const router = express.Router();

	router.get("/", async (req, res) => {
		sendComponent(
			req,
			res,
			deps.base(AdminDashboardsIndexPage(buildAdminDashboardsIndexViewModel(deps.dashboards)), await deps.bannerStateFor(req)),
		);
	});

	async function queryDashboardResults(input: {
		view: DashboardView;
		dashboard: AdminDashboard;
		startTime: Date;
		abort: AbortController;
	}): Promise<readonly DashboardWidgetResult[]> {
		const { view, dashboard, startTime, abort } = input;
		const identities = dashboard.usesExclusions ? await deps.readExcludedIdentities() : NO_EXCLUSIONS;
		const settled = await Promise.allSettled(
			dashboard.widgets(identities).map(async (spec) => {
				try {
					const rows = await deps.runLogsInsightsQuery(
						{ logGroupNames: spec.logGroupNames, queryString: spec.query, startTime, endTime: view.endTime },
						{ signal: abort.signal },
					);
					return { spec, rows };
				} catch (error) {
					abort.abort(error);
					throw error;
				}
			}),
		);
		if (abort.signal.aborted) throw abort.signal.reason;
		const results = settled.map((result) => {
			assert(result.status === "fulfilled", "a rejected widget query aborts the request before rendering");
			return result.value;
		});
		deps.keepDashboardResults({ view, results });
		return results;
	}

	router.get("/:slug", async (req, res, next) => {
		const slug = AdminDashboardSlugSchema.safeParse(req.params.slug);
		if (!slug.success) {
			next();
			return;
		}
		const abort = new AbortController();
		const dashboard = deps.dashboards[slug.data];
		const range = parseDashboardRange(req.query);
		const { startTime, endTime } = dashboardWindow({ range, now: deps.now() });
		const view: DashboardView = { slug: slug.data, range, endTime };
		const kept = deps.findDashboardResults(view);
		const widgets = kept ?? (await queryDashboardResults({ view, dashboard, startTime, abort }));
		const viewModel = buildAdminDashboardViewModel({ slug: slug.data, dashboard, range, startTime, endTime, widgets });
		sendComponent(req, res, deps.base(AdminDashboardPage(viewModel), await deps.bannerStateFor(req)));
	});

	return router;
}
