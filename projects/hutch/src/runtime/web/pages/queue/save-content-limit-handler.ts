import type { ErrorRequestHandler } from "express";
import { wantsSiren } from "../../content-negotiation";
import { SIREN_MEDIA_TYPE, sirenError } from "../../api/siren";

/**
 * Translates body-parser `entity.too.large` errors on the save-content route
 * into a Siren 422 carrying the `save-article` fallback action, so the
 * extension can drop the oversized content and degrade onto the URL-only crawl
 * path. Mirrors `initSavePdfLimitHandler` with a content-type-agnostic message.
 */
export function initSaveContentLimitHandler(deps: {
	logError: (message: string, error?: Error) => void;
	maxBytes: number;
}): ErrorRequestHandler {
	const { maxBytes } = deps;
	const label = `${Math.round(maxBytes / (1024 * 1024))} MB`;
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
					actions: [
						{
							name: "save-article",
							href: "/queue",
							method: "POST",
							type: "application/json",
							fields: [{ name: "url", type: "url" }],
						},
					],
				}),
			);
			return;
		}
		next(err);
	};
}
