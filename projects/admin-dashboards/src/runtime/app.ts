import assert from "node:assert";
import express, { type Express, type Request } from "express";
import cookieParser from "cookie-parser";
import {
	type BannerState,
	type RenderBase,
	bannerStateFromRequest,
	createCspNonceMiddleware,
	generateCspNonce,
	sendContentSecurityPolicy,
} from "@packages/web-shell";
import type { LoginState, ResolveLogin } from "@packages/web-session";
import type { Logger } from "@packages/logger";
import {
	type AnalyticsEvent,
	createAnalyticsMiddleware,
	createClickAttributionMiddleware,
	createVisitorIdMiddleware,
	utmValidationMiddleware,
} from "@packages/web-analytics";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import { initRefuseAdminAccess, initRequireAdmin } from "@packages/admin-gate";
import type { AdminDashboard, AdminDashboardSlug } from "@packages/dashboard-widgets";
import type { FindSessionAdminMfaVerifiedAt, FindUserByEmail } from "@packages/provider-contracts/auth";
import type { ReadExcludedIdentities, RunLogsInsightsQuery } from "@packages/provider-contracts/logs-insights";
import type { FindDashboardResults, KeepDashboardResults } from "./dashboards/admin-dashboard-results";
import { initAdminDashboardsRoutes } from "./dashboards/admin-dashboards.page";
import { ADMIN_DASHBOARDS_PATH } from "./dashboards/admin-dashboards.url";
import { ADMIN_DASHBOARD_STYLES } from "./dashboards/admin-dashboard.styles";
import { logAndRespondOnError } from "./web/error-handler";

export interface AdminDashboardsAppDependencies {
	base: RenderBase;
	resolveLogin: ResolveLogin;
	findUserByEmail: FindUserByEmail;
	findSessionAdminMfaVerifiedAt: FindSessionAdminMfaVerifiedAt;
	adminEmails: readonly string[];
	dashboards: Record<AdminDashboardSlug, AdminDashboard>;
	runLogsInsightsQuery: RunLogsInsightsQuery;
	readExcludedIdentities: ReadExcludedIdentities;
	findDashboardResults: FindDashboardResults;
	keepDashboardResults: KeepDashboardResults;
	analyticsLogger: Logger.Typed<AnalyticsEvent>;
	logger: Logger;
	salt: string;
	now: () => Date;
	generateVisitorId: () => string;
	secureCookies: boolean;
	ownHost: string;
	edgeSecret: string;
}

export function createAdminDashboardsApp(deps: AdminDashboardsAppDependencies): Express {
	const app = express();
	app.disable("x-powered-by");

	const isStaticAssetPath = () => false;
	const canonicalizeLandingPath = (path: string) => path;
	const logins = new WeakMap<Request, LoginState>();

	app.use(createViewerIdentityMiddleware({ edgeSecret: deps.edgeSecret }));
	app.use(createCspNonceMiddleware({ generateCspNonce }));
	app.use(sendContentSecurityPolicy);
	app.use(utmValidationMiddleware);
	app.use(cookieParser());
	app.use(
		createVisitorIdMiddleware({
			generateVisitorId: deps.generateVisitorId,
			secure: deps.secureCookies,
			isStaticAssetPath,
		}),
	);
	app.use(
		createClickAttributionMiddleware({
			now: deps.now,
			secure: deps.secureCookies,
			isStaticAssetPath,
			canonicalizeLandingPath,
			ownHost: deps.ownHost,
		}),
	);
	app.use(
		createAnalyticsMiddleware({
			logger: deps.analyticsLogger,
			salt: deps.salt,
			now: deps.now,
			isStaticAssetPath,
			ownHost: deps.ownHost,
		}),
	);
	app.use(async (req, _res, next) => {
		const login = await deps.resolveLogin(req.headers.cookie);
		logins.set(req, login);
		if (login.isAuthenticated && !login.ageLocked) req.userId = login.userId;
		next();
	});

	const bannerStateFor = async (req: Request): Promise<BannerState> => {
		const login = logins.get(req);
		assert(login, "every request is resolved before the admin gate");
		assert(login.isAuthenticated, "the admin gate only reaches a page for a signed-in reader");
		return bannerStateFromRequest({
			userId: req.userId,
			emailVerified: login.emailVerified,
			originalUrl: req.originalUrl,
			cspNonce: req.cspNonce,
		});
	};

	const noStore: express.RequestHandler = (_req, res, next) => {
		res.set("Cache-Control", "no-store");
		next();
	};

	app.use(
		ADMIN_DASHBOARDS_PATH,
		noStore,
		initRequireAdmin({
			findUserByEmail: deps.findUserByEmail,
			adminEmails: deps.adminEmails,
			serviceToken: { kind: "refused" },
			secondFactor: { kind: "enforced", findSessionAdminMfaVerifiedAt: deps.findSessionAdminMfaVerifiedAt, now: deps.now },
			refuse: initRefuseAdminAccess({ base: deps.base, bannerStateFor, styles: ADMIN_DASHBOARD_STYLES }),
		}),
		initAdminDashboardsRoutes({
			base: deps.base,
			bannerStateFor,
			dashboards: deps.dashboards,
			runLogsInsightsQuery: deps.runLogsInsightsQuery,
			readExcludedIdentities: deps.readExcludedIdentities,
			now: deps.now,
			findDashboardResults: deps.findDashboardResults,
			keepDashboardResults: deps.keepDashboardResults,
		}),
	);

	app.use((_req, res) => {
		res.sendStatus(404);
	});
	app.use(logAndRespondOnError({ logger: deps.logger, now: deps.now }));

	return app;
}
