import { baseCookieOptions } from "@packages/web-analytics";
import type { Request, Response } from "express";

import {
	HOMEPAGE_SPLIT,
	type HomepageSplitConfig,
	type HomepageSplitVariant,
	variantBySlug,
} from "./homepage-split";

/**
 * A first-party, server-written record of which homepage arm a visitor landed
 * on, so a signup completed later can be attributed to arm A or B.
 *
 * Why this exists separately from the `hutch_click` attribution cookie: that
 * cookie is set on the visitor's *first* GET (the bare `/`, before the
 * client-side split redirect) and then never refreshed, so it carries
 * `landing_path: "/"` and no arm. CloudWatch Insights cannot join the landing
 * pageview line to the conversion line, so the arm has to ride the conversion
 * event itself — which means it has to be readable server-side at signup time.
 * The landing route stamps this cookie when it renders an arm; the six
 * `emitUserCreated` call sites read it back.
 *
 * Stored form is `<campaign>:<epoch>:<slug>`, mirroring `formatStoredVariant`'s
 * epoch-prefixing so a renamed campaign or a bumped epoch discards a stale
 * assignment exactly as the client discards its localStorage bucket.
 */
export const EXPERIMENT_COOKIE_NAME = "hutch_exp";
const EXPERIMENT_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function formatAssignment(config: HomepageSplitConfig, variant: HomepageSplitVariant): string {
	return `${config.campaign}:${config.epoch}:${variant.slug}`;
}

export function writeHomepageAssignment(
	res: Response,
	input: { config: HomepageSplitConfig; variant: HomepageSplitVariant; secure: boolean },
): void {
	res.cookie(EXPERIMENT_COOKIE_NAME, formatAssignment(input.config, input.variant), {
		...baseCookieOptions(input.secure),
		maxAge: EXPERIMENT_COOKIE_MAX_AGE_MS,
	});
}

/**
 * A cookie whose campaign or epoch no longer matches, or whose slug is unknown,
 * is treated as absent — the same forgiving stance `parseStoredVariant` takes,
 * so a re-bucket or a renamed experiment reads as "no assignment" rather than a
 * corrupt one.
 */
export function readHomepageAssignment(
	req: Request,
	config: HomepageSplitConfig,
): HomepageSplitVariant | undefined {
	const raw = req.cookies?.[EXPERIMENT_COOKIE_NAME];
	if (typeof raw !== "string") return undefined;
	const parts = raw.split(":");
	if (parts.length !== 3) return undefined;
	const [campaign, epoch, slug] = parts;
	if (campaign !== config.campaign) return undefined;
	if (epoch !== String(config.epoch)) return undefined;
	return variantBySlug(config, slug);
}

/** The bound reader the signup paths use — `readHomepageAssignment` against the
 * live experiment config, returning just the arm slug for the conversion event. */
export function readHomepageVariantSlug(req: Request): string | undefined {
	return readHomepageAssignment(req, HOMEPAGE_SPLIT)?.slug;
}
