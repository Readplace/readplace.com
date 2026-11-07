import assert from "node:assert";
import type { Request, Response, Router } from "express";
import express from "express";
import type { PublishExportUserDataCommand } from "@packages/provider-contracts/events";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { sendComponent } from "@packages/web-shell";
import { ExportPage } from "./export.component";

interface ExportDependencies {
	publishExportUserDataCommand: PublishExportUserDataCommand;
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
		await deps.publishExportUserDataCommand({
			userId: req.userId,
			requestedAt: deps.now().toISOString(),
		});

		res.redirect(303, "/export?status=preparing");
	});

	return router;
}
