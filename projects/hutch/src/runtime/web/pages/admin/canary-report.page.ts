import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { sendComponent } from "@packages/web-shell";
import type { FindUserByEmail } from "@packages/provider-contracts/auth";
import {
	CanaryNameSchema,
	CanaryReportSourceSchema,
	type FindCanaryReport,
} from "@packages/provider-contracts/canary-report";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { CanaryReportPage } from "./canary-report.component";
import { initRefuseAdminAccess } from "./admin-forbidden.page";
import { initRequireAdmin } from "./require-admin.middleware";

export interface AdminCanaryReportDependencies {
	findUserByEmail: FindUserByEmail;
	adminEmails: readonly string[];
	findCanaryReport: FindCanaryReport;
	buildBannerState: BuildBannerState;
}

function noStore(_req: Request, res: Response, next: NextFunction): void {
	res.setHeader("Cache-Control", "no-store");
	next();
}

export function initAdminCanaryReportRoutes(deps: AdminCanaryReportDependencies): Router {
	const router = express.Router();

	router.use(noStore);
	router.use(
		initRequireAdmin({
			findUserByEmail: deps.findUserByEmail,
			adminEmails: deps.adminEmails,
			serviceToken: "",
			refuse: initRefuseAdminAccess({ buildBannerState: deps.buildBannerState }),
		}),
	);

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
