import type { Request } from "express";

export const FREE_PLAN_BANNER_DISMISS_COOKIE_NAME = "hutch_free_plan_banner_dismissed";

export function isFreePlanBannerDismissed(req: Request): boolean {
	return req.cookies?.[FREE_PLAN_BANNER_DISMISS_COOKIE_NAME] === "1";
}
