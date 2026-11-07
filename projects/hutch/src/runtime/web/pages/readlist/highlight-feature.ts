import type { HighlightId } from "@packages/domain/article";
import type { NextFunction, Request, Response } from "express";
import {
	QuerystringFeatureToggle,
	withInternalTracking,
} from "@packages/web-shell";
import { requestedReaderSection } from "../../shared/article-body/reader-slot/section-pages";
import {
	type LinkParams,
	parseReadlistUrl,
	READLIST_PATH,
	readlistReturnQuery,
} from "./readlist.url";

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

export function withHighlightFeature(input: {
	path: string;
	enabled: boolean;
	extra?: LinkParams;
}): string {
	const params = new URLSearchParams();
	for (const [key, value] of input.extra ?? []) params.append(key, value);
	for (const [key, value] of highlightFeatureParams(input.enabled))
		params.append(key, value);
	const search = params.toString();
	return search ? `${input.path}?${search}` : input.path;
}

export interface HighlightPaths {
	viewPath: string;
	createUrl: string;
	deleteUrlFor: (highlightId: HighlightId) => string;
	noteCreateUrl: string;
	noteUrlFor: (highlightId: HighlightId) => string;
}

export function highlightPathsFor(input: {
	articleId: string;
	query: Record<string, unknown>;
}): HighlightPaths {
	const section = requestedReaderSection(input.query.section);
	const sectionParams: LinkParams =
		section === undefined ? [] : [["section", String(section)]];
	const extra: LinkParams = [
		...new URLSearchParams(readlistReturnQuery(parseReadlistUrl(input.query))),
		...sectionParams,
	];
	const base = `${READLIST_PATH}/${input.articleId}`;
	return {
		viewPath: withHighlightFeature({
			path: `${base}/view`,
			enabled: true,
			extra,
		}),
		createUrl: withInternalTracking(
			withHighlightFeature({
				path: `${base}/highlights`,
				enabled: true,
				extra,
			}),
			{
				source: "highlight-toolbar",
				content: "highlight",
			},
		),
		deleteUrlFor: (highlightId) =>
			withInternalTracking(
				withHighlightFeature({
					path: `${base}/highlights/${highlightId}/delete`,
					enabled: true,
					extra,
				}),
				{ source: "highlights-rail", content: "delete-highlight" },
			),
		noteCreateUrl: withInternalTracking(
			withHighlightFeature({
				path: `${base}/highlights`,
				enabled: true,
				extra,
			}),
			{
				source: "highlight-toolbar",
				content: "save-note",
			},
		),
		noteUrlFor: (highlightId) =>
			withInternalTracking(
				withHighlightFeature({
					path: `${base}/highlights/${highlightId}/note`,
					enabled: true,
					extra,
				}),
				{ source: "highlights-rail", content: "edit-note" },
			),
	};
}
