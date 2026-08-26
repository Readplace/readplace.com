import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { GMAIL_FEATURE, QuerystringFeatureToggle, sendComponent } from "@packages/web-shell";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { IntegrationsIndexPage } from "./integrations-index.component";
import { toIntegrationsIndexViewModel } from "./integrations-index.viewmodel";

interface IntegrationsDependencies {
	buildBannerState: BuildBannerState;
	requireAuth: RequestHandler;
}

export function initIntegrationsRoutes(deps: IntegrationsDependencies): Router {
	const router = express.Router();
	const featureToggle = new QuerystringFeatureToggle();

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
		sendComponent(
			req,
			res,
			Base(IntegrationsIndexPage(toIntegrationsIndexViewModel()), await deps.buildBannerState(req)),
		);
	});

	return router;
}
