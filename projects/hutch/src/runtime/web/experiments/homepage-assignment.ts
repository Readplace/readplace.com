import { baseCookieOptions } from "@packages/web-analytics";
import type { Request, Response } from "express";

import {
	HOMEPAGE_SPLIT,
	type HomepageSplitConfig,
	type HomepageSplitVariant,
	variantBySlug,
} from "./homepage-split";

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

export function readHomepageVariantSlug(req: Request): string | undefined {
	return readHomepageAssignment(req, HOMEPAGE_SPLIT)?.slug;
}
