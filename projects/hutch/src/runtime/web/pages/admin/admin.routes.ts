import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { CANARY_REPORTS_PATH } from "@packages/provider-contracts/canary-report";
import { withSyntacticUnwrap } from "@packages/save-article";
import type { AppDependencies } from "../../../server";
import { AUTH_DIAGNOSTICS_LOG_GROUP } from "../../../auth-diagnostics/dashboard";
import { initUpdateNewsletterCatalog } from "../../../domain/newsletter-catalog/update-newsletter-catalog";
import { buildAdminDashboards } from "../../../observability/admin-dashboards";
import { ANALYTICS_LOG_GROUP } from "../../../observability/events";
import type { EmitLifecycleEmailSent } from "../../../observability/lifecycle-email-events";
import type { BuildBannerState } from "../../banner-state";
import { initAdminDashboardsRoutes } from "./admin-dashboards.page";
import { ADMIN_DASHBOARDS_PATH } from "./admin-dashboards.url";
import { initRefuseAdminAccess } from "./admin-forbidden.page";
import { initAdminIndexHandler } from "./admin-index.page";
import { initAdminNewslettersRoutes } from "./admin-newsletters.page";
import { initAdminCanaryReportRoutes } from "./canary-report.page";
import { initAdminExtendTrialRoutes } from "./extend-trial.page";
import { initAdminFounderNotesRoutes } from "./founder-notes.page";
import { initAdminRecrawlRoutes } from "./recrawl.page";
import { initRequireAdmin, serviceTokenPolicy } from "./require-admin.middleware";

function noStore(_req: Request, res: Response, next: NextFunction): void {
	res.setHeader("Cache-Control", "no-store");
	next();
}

export function initAdminRoutes(
	deps: Pick<
		AppDependencies,
		| "findArticleByUrl"
		| "findItemOwner"
		| "resolveCanonicalIdentity"
		| "resolveWrapperTarget"
		| "findArticleFreshness"
		| "findArticleCrawlVersions"
		| "readArticleContent"
		| "findGeneratedSummary"
		| "findArticleCrawlStatus"
		| "markCrawlPending"
		| "forceMarkCrawlPending"
		| "publishRecrawlLinkInitiated"
		| "findUserByEmail"
		| "subscriptionProviders"
		| "trialScheduler"
		| "logError"
		| "now"
		| "readNewsletterCatalog"
		| "writeNewsletterCatalog"
		| "newsletterCatalogSeed"
		| "findCanaryReport"
		| "adminDashboards"
		| "adminEmails"
		| "recrawlServiceToken"
		| "readerSectionThresholdBytes"
	>,
	built: { appOrigin: string; buildBannerState: BuildBannerState; emitLifecycleEmailSent: EmitLifecycleEmailSent },
): Router {
	const { appOrigin, buildBannerState, emitLifecycleEmailSent } = built;
	const router = express.Router();
	const refuse = initRefuseAdminAccess({ buildBannerState });
	const withServiceToken = initRequireAdmin({
		findUserByEmail: deps.findUserByEmail,
		adminEmails: deps.adminEmails,
		serviceToken: serviceTokenPolicy(deps.recrawlServiceToken),
		refuse,
	});
	const sessionOnly = initRequireAdmin({
		findUserByEmail: deps.findUserByEmail,
		adminEmails: deps.adminEmails,
		serviceToken: { kind: "refused" },
		refuse,
	});

	const adminRecrawlRouter = initAdminRecrawlRoutes({
		appOrigin,
		findArticleByUrl: deps.findArticleByUrl,
		findItemOwner: deps.findItemOwner,
		resolveCanonicalIdentity: deps.resolveCanonicalIdentity,
		resolveWrapperTarget: withSyntacticUnwrap(deps.resolveWrapperTarget),
		findArticleFreshness: deps.findArticleFreshness,
		findArticleCrawlVersions: deps.findArticleCrawlVersions,
		readArticleContent: deps.readArticleContent,
		findGeneratedSummary: deps.findGeneratedSummary,
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		markCrawlPending: deps.markCrawlPending,
		forceMarkCrawlPending: deps.forceMarkCrawlPending,
		publishRecrawlLinkInitiated: deps.publishRecrawlLinkInitiated,
		buildBannerState,
		now: deps.now,
		readerSectionThresholdBytes: deps.readerSectionThresholdBytes,
	});
	router.use("/admin/recrawl", noStore, withServiceToken, adminRecrawlRouter);

	const adminExtendTrialRouter = initAdminExtendTrialRoutes({
		findUserByEmail: deps.findUserByEmail,
		findSubscriptionByUserId: deps.subscriptionProviders.findByUserId,
		upsertTrialing: deps.subscriptionProviders.upsertTrialing,
		trialScheduler: deps.trialScheduler,
		logError: deps.logError,
		now: deps.now,
		buildBannerState,
	});
	router.use("/admin/extend-trial", noStore, withServiceToken, adminExtendTrialRouter);

	router.use(
		"/admin/founder-notes",
		noStore,
		withServiceToken,
		initAdminFounderNotesRoutes({
			findUserByEmail: deps.findUserByEmail,
			findSubscriptionByUserId: deps.subscriptionProviders.findByUserId,
			recordFounderNote: deps.subscriptionProviders.recordFounderNote,
			emitLifecycleEmailSent,
			now: deps.now,
			buildBannerState,
		}),
	);

	router.use(
		"/admin/newsletters",
		noStore,
		sessionOnly,
		initAdminNewslettersRoutes({
			readNewsletterCatalog: deps.readNewsletterCatalog,
			updateNewsletterCatalog: initUpdateNewsletterCatalog({
				readCatalog: deps.readNewsletterCatalog,
				writeCatalog: deps.writeNewsletterCatalog,
				maxAttempts: 3,
			}),
			newsletterCatalogSeed: deps.newsletterCatalogSeed,
			now: deps.now,
			logError: deps.logError,
			buildBannerState,
		}),
	);
	router.use(
		CANARY_REPORTS_PATH,
		noStore,
		sessionOnly,
		initAdminCanaryReportRoutes({
			findCanaryReport: deps.findCanaryReport,
			buildBannerState,
		}),
	);
	router.use(
		ADMIN_DASHBOARDS_PATH,
		noStore,
		sessionOnly,
		initAdminDashboardsRoutes({
			buildBannerState,
			dashboards: buildAdminDashboards({
				analyticsLogGroupName: ANALYTICS_LOG_GROUP,
				authDiagnosticsLogGroupName: AUTH_DIAGNOSTICS_LOG_GROUP,
			}),
			...deps.adminDashboards,
		}),
	);
	router.get("/admin", noStore, sessionOnly, initAdminIndexHandler({ buildBannerState }));

	return router;
}
