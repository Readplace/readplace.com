import type { CountUsers } from "@packages/provider-contracts/auth";
import { sendComponent } from "@packages/web-shell";
import express from "express";
import type { Request, Response, Router } from "express";
import type { BuildBannerState } from "../../banner-state";
import { Base } from "../../base.component";
import { HOMEPAGE_SPLIT } from "../../experiments/homepage-split";
import type { FoundingAllocation } from "../../shared/founding-progress/founding-allocation";
import { QUEUE_PATH } from "../queue/queue.url";
import { HomePage } from "../home";

/**
 * Landing arms for the homepage A/B split. Each renders the existing HomePage
 * tagged with its variant (noindex, no split script — see home.component) so the
 * arms are byte-identical to `/` apart from the marker, and are reached only by
 * the client-side redirect from `/`. Guests render the page; authed users are
 * bounced to /queue, mirroring the `/` handler. These are not hypermedia entry
 * points, so there is no Siren/markdown negotiation here.
 */
export function initLandingRoutes(deps: {
	buildBannerState: BuildBannerState;
	countUsers: CountUsers;
	foundingAllocation: FoundingAllocation;
	staticBaseUrl: string;
}): Router {
	const router = express.Router();
	const { buildBannerState, countUsers, foundingAllocation, staticBaseUrl } = deps;

	async function renderLanding(req: Request, res: Response, variant: "a" | "b"): Promise<void> {
		if (req.userId) {
			res.redirect(303, QUEUE_PATH);
			return;
		}
		const ua = req.headers["user-agent"] ?? "";
		const browser: "firefox" | "chrome" | "other" =
			ua.includes("Firefox/") ? "firefox"
			: ua.includes("Chrome/") ? "chrome"
			: "other";
		const userCount = await countUsers().catch(() => 0);
		const banner = await buildBannerState(req);
		sendComponent(
			req,
			res,
			Base(HomePage({ userCount, staticBaseUrl, browser, foundingAllocation, variant }), banner),
		);
	}

	router.get(HOMEPAGE_SPLIT.variants[0].path, (req, res) => renderLanding(req, res, "a"));
	router.get(HOMEPAGE_SPLIT.variants[1].path, (req, res) => renderLanding(req, res, "b"));

	return router;
}
