import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { sendComponent } from "@packages/web-shell";
import { UserIdSchema } from "@packages/domain/user";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import {
	type GmailConnectContext,
	type GmailIntegrationDependencies,
	registerGmailConnectRoutes,
} from "./gmail-connect.page";
import { registerGmailPageRoutes } from "./gmail.page";
import { IntegrationsIndexPage } from "./integrations-index.component";
import { toIntegrationsIndexViewModel } from "./integrations-index.viewmodel";

interface IntegrationsDependencies {
	buildBannerState: BuildBannerState;
	requireAuth: RequestHandler;
	requireNotLocked: RequestHandler;
	requireWriteAccess: RequestHandler;
	appOrigin: string;
	secureCookies: boolean;
	logError: (message: string, error?: Error) => void;
	now: () => Date;
	gmail: GmailIntegrationDependencies | undefined;
}

export function initIntegrationsRoutes(deps: IntegrationsDependencies): Router {
	const router = express.Router();
	const gmail = deps.gmail;

	if (gmail !== undefined) {
		const context: GmailConnectContext = {
			appOrigin: deps.appOrigin,
			secureCookies: deps.secureCookies,
			logError: deps.logError,
			now: deps.now,
			requireAuth: deps.requireAuth,
		};
		registerGmailConnectRoutes(router, gmail, context);
		registerGmailPageRoutes(router, gmail, {
			buildBannerState: deps.buildBannerState,
			requireAuth: deps.requireAuth,
			requireNotLocked: deps.requireNotLocked,
			requireWriteAccess: deps.requireWriteAccess,
		});
	}

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
