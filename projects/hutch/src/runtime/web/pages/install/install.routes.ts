import type { Request, Response, Router } from "express";
import express from "express";
import type { BuildBannerState } from "../../banner-state";
import { Base } from "../../base.component";
import { sendComponent } from "../../send-component";
import {
	InstallPage,
	type InstallPlatform,
	fetchFirefoxDownloadUrl,
	fetchChromeDownloadUrl,
} from "./install.component";

function parsePlatform(value: unknown): InstallPlatform {
	if (value === "firefox") return "firefox";
	if (value === "iphone") return "iphone";
	return "chrome";
}

export function initInstallRoutes(deps: { buildBannerState: BuildBannerState }): Router {
	const router = express.Router();
	const { buildBannerState } = deps;

	router.get("/install", async (req: Request, res: Response) => {
		const browser = parsePlatform(req.query.browser);
		const [firefox, chrome] = await Promise.all([
			fetchFirefoxDownloadUrl(),
			fetchChromeDownloadUrl(),
		]);
		sendComponent(req, res, Base(InstallPage({ firefox, chrome, browser }), await buildBannerState(req)));
	});

	return router;
}
