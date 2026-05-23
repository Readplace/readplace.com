import assert from "node:assert";
import type { Request, Response, Router } from "express";
import express from "express";
import type { FindEmailByUserId } from "@packages/test-fixtures/providers/auth";
import type { PublishExportUserDataCommand } from "@packages/test-fixtures/providers/events";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { sendComponent } from "../../send-component";
import { ExportPage } from "./export.component";

interface ExportDependencies {
	publishExportUserDataCommand: PublishExportUserDataCommand;
	findEmailByUserId: FindEmailByUserId;
	logError: (message: string, error?: Error) => void;
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
		const userId = req.userId;
		const email = await deps.findEmailByUserId(userId);
		if (!email) {
			deps.logError(`[Export] No email found for userId ${userId}`);
			res.redirect(303, "/export");
			return;
		}

		await deps.publishExportUserDataCommand({
			userId,
			email,
			requestedAt: deps.now().toISOString(),
		});

		res.redirect(303, "/export?status=preparing");
	});

	return router;
}
