import assert from "node:assert";
import type { Router } from "express";
import express from "express";
import { z } from "zod";
import { isbot } from "isbot";
import type { HutchLogger } from "@packages/hutch-logger";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { sendComponent } from "@packages/web-shell";
import { collectUtmParams } from "../../shared/utm";
import { buildSaveIntentEvent, type AnalyticsEvent } from "../../middleware/analytics";
import { SAVE_OUTCOMES, SAVE_SURFACES } from "../../../observability/events";
import { setPendingSaveId } from "../../pending-save";
import { SaveErrorPage } from "./save-error.component";

const SaveUrlSchema = z.url();

function parseUrl(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const parsed = SaveUrlSchema.safeParse(raw);
	return parsed.success ? parsed.data : undefined;
}

export function initSaveRoutes(deps: {
	buildBannerState: BuildBannerState;
	analytics: HutchLogger.Typed<AnalyticsEvent>;
	salt: string;
	now: () => Date;
	secureCookies: boolean;
	generatePendingSaveId: () => string;
}): Router {
	const router = express.Router();

	router.get("/", async (req, res) => {
		const url = parseUrl(typeof req.query.url === "string" ? req.query.url : undefined);

		if (!url) {
			const redirectUrl = req.userId ? "/queue" : "/";
			const linkLabel = req.userId ? "Go to your queue" : "Go to homepage";
			sendComponent(req, res, Base(SaveErrorPage({ redirectUrl, linkLabel }), await deps.buildBannerState(req)));
			return;
		}

		if (!req.userId) {
			if (!isbot(req.get("user-agent"))) {
				assert(req.visitorId, "visitor-id middleware must run before /save");
				const pendingSaveId = deps.generatePendingSaveId();
				setPendingSaveId({ res, secure: deps.secureCookies }, pendingSaveId);
				deps.analytics.info(
					buildSaveIntentEvent(
						{ now: deps.now, salt: deps.salt },
						{
							req,
							url,
							path: req.baseUrl,
							surface: SAVE_SURFACES.readerView,
							outcome: SAVE_OUTCOMES.promptedToSignUp,
							pendingSaveId,
						},
					),
				);
			}
			res.redirect(303, `/login?return=${encodeURIComponent(req.originalUrl)}`);
			return;
		}

		const utm = collectUtmParams(req.query);
		const qs = new URLSearchParams([["url", url], ...utm]).toString();
		res.redirect(303, `/queue?${qs}`);
	});

	return router;
}
