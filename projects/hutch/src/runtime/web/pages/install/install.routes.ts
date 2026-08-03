import type { Request, Response, Router } from "express";
import express from "express";
import type { BuildBannerState } from "../../banner-state";
import { Base } from "../../base.component";
import { sendComponent } from "@packages/web-shell";
import { redirectToDetectedClient } from "./detected-client.middleware";
import {
	InstallPage,
	type InstallClient,
	parseClient,
	fetchFirefoxDownloadUrl,
	isSelfHostedDownload,
} from "./install.component";

export function initInstallRoutes(deps: { buildBannerState: BuildBannerState; staticBaseUrl: string }): Router {
	const router = express.Router();
	const { buildBannerState, staticBaseUrl } = deps;

	router.get("/install", redirectToDetectedClient);

	router.get("/install", async (req: Request, res: Response) => {
		let client: InstallClient;
		try {
			client = parseClient(req.query.client);
		} catch {
			res.status(400).type("html").send("");
			return;
		}
		const firefox = isSelfHostedDownload(client) ? await fetchFirefoxDownloadUrl() : null;
		sendComponent(req, res, Base(InstallPage({ firefox, client, staticBaseUrl }), await buildBannerState(req)));
	});

	return router;
}
