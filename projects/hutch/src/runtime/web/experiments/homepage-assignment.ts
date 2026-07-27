import { baseCookieOptions } from "@packages/web-analytics";
import type { Request, Response } from "express";

import {
	HOMEPAGE_SPLIT,
	type HomepageSplitConfig,
	type HomepageSplitVariant,
	variantBySlug,
} from "./homepage-split";

/**
 * The visitor's homepage arm. `/` reads it to re-render the same arm on every
 * visit, and the six `emitUserCreated` call sites read it back at signup to
 * attribute the conversion to arm A or B.
 *
 * Why this exists separately from the `hutch_click` attribution cookie: that
 * cookie is set on the visitor's *first* GET and then never refreshed, so it
 * carries no arm. CloudWatch Insights cannot join the exposure pageview line to
 * the conversion line, so the arm has to ride the conversion event itself —
 * which means it has to be readable server-side at signup time.
 *
 * Stored form is `<campaign>:<epoch>:<slug>` so a renamed campaign or a bumped
 * epoch reads as "no assignment" and the visitor is re-drawn.
 *
 * The Max-Age matches the year-long `hutch_vid` visitor identity: this cookie
 * IS the assignment, so it must outlive any plausible experiment window — a
 * lapsed cookie re-randomizes the returning visitor into the other arm half the
 * time. `/` re-stamps it on every render, so only lapsed visitors are affected.
 */
export const EXPERIMENT_COOKIE_NAME = "hutch_exp";
const EXPERIMENT_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

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
