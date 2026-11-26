import type { ErrorRequestHandler } from "express";
import { wantsSiren } from "../../content-negotiation";
import { SIREN_MEDIA_TYPE, type SirenAction, sirenError } from "../../api/siren";
import { megabytesLabel } from "../../shared/bytes-to-mb";
import type { LogError } from "@packages/logger";
import { READLIST_PATH } from "./readlist.url";

export const SAVE_LINK_FALLBACK_ACTION: SirenAction = {
	name: "save-article",
	title: "Save a link",
	href: READLIST_PATH,
	method: "POST",
	type: "application/json",
	fields: [{ name: "url", type: "url" }],
};

/**
 * Translates body-parser `entity.too.large` errors on the save-content route
 * into a Siren 422 carrying the `save-article` fallback action, so the
 * extension can drop the oversized content and degrade onto the URL-only crawl
 * path.
 */
export function initSaveContentLimitHandler(deps: {
	logError: LogError;
	maxBytes: number;
}): ErrorRequestHandler {
	const { maxBytes } = deps;
	const label = megabytesLabel(maxBytes);
	return (err, req, res, next) => {
		if (
			typeof err === "object" &&
			err !== null &&
			"type" in err &&
			err.type === "entity.too.large" &&
			"limit" in err &&
			err.limit === maxBytes &&
			wantsSiren(req)
		) {
			deps.logError(
				`save-content request body exceeded ${label}`,
				err instanceof Error ? err : undefined,
			);
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				sirenError({
					code: "content-too-large",
					message: `Content upload exceeded ${label}`,
					actions: [SAVE_LINK_FALLBACK_ACTION],
				}),
			);
			return;
		}
		next(err);
	};
}
