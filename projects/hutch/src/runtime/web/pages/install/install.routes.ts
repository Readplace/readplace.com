import type { Request, Response, Router } from "express";
import express from "express";
import type { BuildBannerState } from "../../banner-state";
import { Base } from "../../base.component";
import { sendComponent } from "@packages/web-shell";
import {
	InstallPage,
	type InstallClient,
	parseClient,
	fetchFirefoxDownloadUrl,
} from "./install.component";

export function initInstallRoutes(deps: { buildBannerState: BuildBannerState }): Router {
	const router = express.Router();
	const { buildBannerState } = deps;

	router.get("/install", async (req: Request, res: Response) => {
		let client: InstallClient;
		try {
			client = parseClient(req.query.client);
		} catch {
			res.status(400).type("html").send("");
			return;
		}
		const firefox = client === "firefox" ? await fetchFirefoxDownloadUrl() : null;
		sendComponent(req, res, Base(InstallPage({ firefox, client }), await buildBannerState(req)));
	});

	return router;
}
