import type { Router } from "express";
import express from "express";
import { sendComponent } from "@packages/web-shell";
import {
	CanaryNameSchema,
	CanaryReportSourceSchema,
	type FindCanaryReport,
} from "@packages/provider-contracts/canary-report";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { CanaryReportPage } from "./canary-report.component";

export interface AdminCanaryReportDependencies {
	findCanaryReport: FindCanaryReport;
	buildBannerState: BuildBannerState;
}

export function initAdminCanaryReportRoutes(deps: AdminCanaryReportDependencies): Router {
	const router = express.Router();

	router.get("/:canary/:source", async (req, res, next) => {
		const canary = CanaryNameSchema.safeParse(req.params.canary);
		const source = CanaryReportSourceSchema.safeParse(req.params.source);
		if (!canary.success || !source.success) {
			next();
			return;
		}
		const report = await deps.findCanaryReport({ canary: canary.data, source: source.data });
		if (report === undefined) {
			next();
			return;
		}
		sendComponent(req, res, Base(CanaryReportPage(report), await deps.buildBannerState(req)));
	});

	return router;
}
