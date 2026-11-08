import type { NextFunction, Request, Response } from "express";
import { QuerystringFeatureToggle } from "@packages/web-shell";
import type { LinkParams } from "./readlist.url";

export const HIGHLIGHT_FEATURE = "highlight";

const featureToggle = new QuerystringFeatureToggle();

export function highlightFeatureEnabled(
	query: Record<string, unknown>,
): boolean {
	return featureToggle.isEnabled({ query }, HIGHLIGHT_FEATURE);
}

export function requireHighlightFeature(
	req: Request,
	_res: Response,
	next: NextFunction,
): void {
	next(highlightFeatureEnabled(req.query) ? undefined : "router");
}

export function highlightFeatureParams(enabled: boolean): LinkParams {
	return enabled ? [["feature", HIGHLIGHT_FEATURE]] : [];
}
