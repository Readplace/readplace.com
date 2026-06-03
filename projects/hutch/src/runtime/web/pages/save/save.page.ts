import assert from "node:assert";
import type { Router } from "express";
import express from "express";
import { z } from "zod";
import { isbot } from "isbot";
import type { HutchLogger } from "@packages/hutch-logger";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { sendComponent } from "../../send-component";
import { collectUtmParams } from "../../shared/utm";
import { hashIp, type AnalyticsEvent } from "../../middleware/analytics";
import { ANALYTICS_EVENTS, STREAMS } from "../../../observability/events";
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
				deps.analytics.info({
					stream: STREAMS.analytics,
					event: ANALYTICS_EVENTS.viewSaveIntent,
					timestamp: deps.now().toISOString(),
					path: req.baseUrl,
					article_host: new URL(url).hostname,
					visitor_hash: hashIp({ ip: req.ip, salt: deps.salt }),
					visitor_id: req.visitorId,
					is_authenticated: 0,
				});
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
