import type { ErrorRequestHandler } from "express";
import { wantsSiren } from "../../content-negotiation";
import { SIREN_MEDIA_TYPE, sirenError } from "../../api/siren";

/**
 * Translates body-parser `entity.too.large` errors on the multipart
 * save-articles route into a Siren 422, so a bulk request whose combined
 * captured-page bodies exceed the parser limit fails cleanly instead of escaping
 * to the global handler as an unhandled 413. This parser limit is the route's
 * only size bound — there is no per-page refusal — and the walker packs each
 * request's manifest and content bytes under the advertised per-page budget,
 * whose headroom keeps a compliant request below this limit.
 */
export function initSaveArticlesLimitHandler(deps: {
	logError: (message: string, error?: Error) => void;
	maxBytes: number;
}): ErrorRequestHandler {
	const { maxBytes } = deps;
	const label = `${Math.round((maxBytes / (1024 * 1024)) * 10) / 10} MB`;
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
				`save-articles request body exceeded ${label}`,
				err instanceof Error ? err : undefined,
			);
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				sirenError({
					code: "save-articles-too-large",
					message: `Captured tab content was too large to upload in one request (over ${label})`,
				}),
			);
			return;
		}
		next(err);
	};
}
