import assert from "node:assert";
import type { Request, Response, Router } from "express";
import express from "express";
import type { RateLimitRule } from "@packages/domain/rate-limit";
import type { PublishExportUserDataCommand } from "@packages/provider-contracts/events";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import { type GetEffectiveAccess, isDailyLimited } from "@packages/subscription-access";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { sendComponent } from "@packages/web-shell";
import { ExportPage } from "./export.component";

interface ExportDependencies {
	publishExportUserDataCommand: PublishExportUserDataCommand;
	getEffectiveAccess: GetEffectiveAccess;
	consumeRateLimit: ConsumeRateLimit;
	exportRule: RateLimitRule;
	now: () => Date;
	buildBannerState: BuildBannerState;
}

export function initExportRoutes(deps: ExportDependencies): Router {
	const router = express.Router();

	router.get("/", async (req: Request, res: Response) => {
		const status = req.query.status === "preparing" ? "preparing" : "idle";
		sendComponent(req, res, Base(ExportPage({ status }), await deps.buildBannerState(req)));
	});

	router.post("/start", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		if (isDailyLimited(await deps.getEffectiveAccess(req.userId))) {
			const decision = await deps.consumeRateLimit({ bucket: "export", key: req.userId, rule: deps.exportRule });
			if (!decision.allowed) {
				res.set("Retry-After", String(decision.retryAfterSeconds));
				sendComponent(
					req,
					res,
					Base(
						ExportPage({
							status: "limit-reached",
							limit: deps.exportRule.limit,
							retryAfterSeconds: decision.retryAfterSeconds,
						}),
						await deps.buildBannerState(req),
					),
				);
				return;
			}
		}
		await deps.publishExportUserDataCommand({
			userId: req.userId,
			requestedAt: deps.now().toISOString(),
		});

		res.redirect(303, "/export?status=preparing");
	});

	return router;
}
