import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { sendComponent } from "@packages/web-shell";
import type { FindUserByEmail } from "@packages/provider-contracts/auth";
import type {
	ExcludedIdentities,
	ReadExcludedIdentities,
	RunLogsInsightsQuery,
} from "@packages/provider-contracts/logs-insights";
import type { AdminDashboard, AdminDashboardSlug } from "../../../observability/admin-dashboards";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { AdminDashboardPage, AdminDashboardsIndexPage } from "./admin-dashboard.component";
import { buildAdminDashboardViewModel, buildAdminDashboardsIndexViewModel } from "./admin-dashboard.viewmodel";
import { AdminDashboardSlugSchema, dashboardWindow, parseDashboardRange } from "./admin-dashboards.url";
import { initRefuseAdminAccess } from "./admin-forbidden.page";
import { initRequireAdmin } from "./require-admin.middleware";

export interface AdminDashboardsDependencies {
	findUserByEmail: FindUserByEmail;
	adminEmails: readonly string[];
	buildBannerState: BuildBannerState;
	dashboards: Record<AdminDashboardSlug, AdminDashboard>;
	runLogsInsightsQuery: RunLogsInsightsQuery;
	readExcludedIdentities: ReadExcludedIdentities;
	now: () => Date;
}

const NO_EXCLUSIONS: ExcludedIdentities = { excludedVisitorIds: [], excludedUserIds: [] };

function noStore(_req: Request, res: Response, next: NextFunction): void {
	res.setHeader("Cache-Control", "no-store");
	next();
}

export function initAdminDashboardsRoutes(deps: AdminDashboardsDependencies): Router {
	const router = express.Router();

	router.use(noStore);
	router.use(
		initRequireAdmin({
			findUserByEmail: deps.findUserByEmail,
			adminEmails: deps.adminEmails,
			serviceToken: "",
			refuse: initRefuseAdminAccess({ buildBannerState: deps.buildBannerState }),
		}),
	);

	router.get("/", async (req, res) => {
		sendComponent(
			req,
			res,
			Base(AdminDashboardsIndexPage(buildAdminDashboardsIndexViewModel(deps.dashboards)), await deps.buildBannerState(req)),
		);
	});

	router.get("/:slug", async (req, res, next) => {
		const slug = AdminDashboardSlugSchema.safeParse(req.params.slug);
		if (!slug.success) {
			next();
			return;
		}
		const dashboard = deps.dashboards[slug.data];
		const range = parseDashboardRange(req.query);
		const { startTime, endTime } = dashboardWindow({ range, now: deps.now() });
		const identities = dashboard.usesExclusions ? await deps.readExcludedIdentities() : NO_EXCLUSIONS;
		const widgets = await Promise.all(
			dashboard.widgets(identities).map(async (spec) => ({
				spec,
				rows: await deps.runLogsInsightsQuery({
					logGroupNames: spec.logGroupNames,
					queryString: spec.query,
					startTime,
					endTime,
				}),
			})),
		);
		const viewModel = buildAdminDashboardViewModel({ slug: slug.data, dashboard, range, startTime, endTime, widgets });
		sendComponent(req, res, Base(AdminDashboardPage(viewModel), await deps.buildBannerState(req)));
	});

	return router;
}
