import type { CountUsers } from "@packages/provider-contracts/auth";
import { sendComponent } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import express from "express";
import type { Request, Response, Router } from "express";
import type { BuildBannerState } from "../../banner-state";
import { Base } from "../../base.component";
import { writeHomepageAssignment } from "../../experiments/homepage-assignment";
import {
	HOMEPAGE_SPLIT,
	type HomepageSplitVariant,
	type HomepageVariantMarker,
} from "../../experiments/homepage-split";
import { readLastViewUrl } from "../../last-view";
import { detectInstallBrowser } from "../../onboarding/extension-install";
import type { InstallBrowser } from "../../onboarding/onboarding.types";
import type { FoundingAllocation } from "../../shared/founding-progress/founding-allocation";
import { QUEUE_PATH } from "../queue/queue.url";
import { HomePage } from "../home";
import { HomeVariantBPage } from "../home-b";

interface ArmInput {
	readonly userCount: number;
	readonly staticBaseUrl: string;
	readonly browser: InstallBrowser;
	readonly foundingAllocation: FoundingAllocation;
	readonly lastViewUrl: string | undefined;
	readonly variant: HomepageVariantMarker;
}

/**
 * Which page each arm renders. `satisfies Record<HomepageVariantMarker, …>` makes
 * a third arm a compile error until it earns a renderer, and keeps the two arms
 * free to render entirely different components — the whole point of the split.
 * Arm A is the incumbent homepage; arm B is the trial-first rewrite, which reads
 * the last-view cookie so a reader-view arrival gets the arrival treatment.
 */
const ARM_RENDERERS = {
	a: (input: ArmInput): PageBody =>
		HomePage({
			userCount: input.userCount,
			staticBaseUrl: input.staticBaseUrl,
			browser: input.browser,
			foundingAllocation: input.foundingAllocation,
			variant: input.variant,
		}),
	b: (input: ArmInput): PageBody =>
		HomeVariantBPage({
			staticBaseUrl: input.staticBaseUrl,
			variant: input.variant,
			lastViewUrl: input.lastViewUrl,
		}),
} satisfies Record<HomepageVariantMarker, (input: ArmInput) => PageBody>;

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
	secureCookies: boolean;
}): Router {
	const router = express.Router();
	const { buildBannerState, countUsers, foundingAllocation, staticBaseUrl, secureCookies } = deps;

	async function renderLanding(
		req: Request,
		res: Response,
		variant: HomepageSplitVariant,
	): Promise<void> {
		if (req.userId) {
			res.redirect(303, QUEUE_PATH);
			return;
		}
		// Record the arm server-side so a later signup can be attributed to it —
		// the client-set localStorage bucket never reaches the signup handler.
		writeHomepageAssignment(res, { config: HOMEPAGE_SPLIT, variant, secure: secureCookies });
		const browser = detectInstallBrowser(req);
		const userCount = await countUsers().catch(() => 0);
		const banner = await buildBannerState(req);
		const body = ARM_RENDERERS[variant.marker]({
			userCount,
			staticBaseUrl,
			browser,
			foundingAllocation,
			lastViewUrl: readLastViewUrl(req),
			variant: variant.marker,
		});
		sendComponent(req, res, Base(body, banner));
	}

	router.get(HOMEPAGE_SPLIT.variants[0].path, (req, res) =>
		renderLanding(req, res, HOMEPAGE_SPLIT.variants[0]),
	);
	router.get(HOMEPAGE_SPLIT.variants[1].path, (req, res) =>
		renderLanding(req, res, HOMEPAGE_SPLIT.variants[1]),
	);

	return router;
}
