import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { GMAIL_FEATURE, QuerystringFeatureToggle, sendComponent } from "@packages/web-shell";
import { UserIdSchema } from "@packages/domain/user";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import {
	type GmailConnectContext,
	type GmailIntegrationDependencies,
	registerGmailConnectRoutes,
} from "./gmail-connect.page";
import { IntegrationsIndexPage } from "./integrations-index.component";
import { toIntegrationsIndexViewModel } from "./integrations-index.viewmodel";

interface IntegrationsDependencies {
	buildBannerState: BuildBannerState;
	requireAuth: RequestHandler;
	appOrigin: string;
	secureCookies: boolean;
	logError: (message: string, error?: Error) => void;
	now: () => Date;
	gmail: GmailIntegrationDependencies | undefined;
}

export function initIntegrationsRoutes(deps: IntegrationsDependencies): Router {
	const router = express.Router();
	const featureToggle = new QuerystringFeatureToggle();
	const gmail = deps.gmail;

	// Registered before the feature gate: Google owns the callback URL it returns
	// to and will not echo `?feature=gmail`, so a gated callback would 404 every
	// completed grant.
	if (gmail !== undefined) {
		const context: GmailConnectContext = {
			appOrigin: deps.appOrigin,
			secureCookies: deps.secureCookies,
			logError: deps.logError,
			now: deps.now,
			requireAuth: deps.requireAuth,
		};
		registerGmailConnectRoutes(router, gmail, context);
	}

	// The gate runs before requireAuth so a reader who has not opted in cannot
	// tell the destination exists: they fall through to the catch-all 404 rather
	// than being bounced to /login.
	router.use((req: Request, _res: Response, next: express.NextFunction) => {
		if (featureToggle.isEnabled(req, GMAIL_FEATURE)) {
			next();
			return;
		}
		next("router");
	});

	router.get("/", deps.requireAuth, async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = UserIdSchema.parse(req.userId);
		const refreshToken = await gmail?.gmailCredentialsStore.findRefreshTokenByUserId(userId);
		const vm = toIntegrationsIndexViewModel({
			gmailConnected: refreshToken !== undefined,
			error: typeof req.query.error === "string" ? req.query.error : undefined,
			justConnected: req.query.connected === "1",
		});
		sendComponent(req, res, Base(IntegrationsIndexPage(vm), await deps.buildBannerState(req)));
	});

	return router;
}
