import type { ErrorRequestHandler } from "express";
import { MAX_PDF_BYTES } from "@packages/crawl-article";
import { wantsSiren } from "../../content-negotiation";
import { SIREN_MEDIA_TYPE, sirenError } from "../../api/siren";

/**
 * Translates body-parser `entity.too.large` errors on the save-pdf route into
 * a Siren 422 carrying the `save-article` fallback action, so the extension
 * can drop the oversized PDF and degrade onto the URL-only crawl path.
 *
 * Mirrors `saveHtmlLimitHandler` (declared inline in queue.page.ts) — extracted
 * here so the trigger can be unit-tested without sending a 500 MiB body
 * through supertest.
 */
export function initSavePdfLimitHandler(deps: {
	logError: (message: string, error?: Error) => void;
	maxBytes: number;
}): ErrorRequestHandler {
	const { maxBytes } = deps;
	return (err, req, res, next) => {
		const bodyErr = err as { type?: string; limit?: number } | null;
		if (
			bodyErr?.type === "entity.too.large" &&
			bodyErr.limit === maxBytes &&
			wantsSiren(req)
		) {
			deps.logError(
				`save-pdf request body exceeded ${MAX_PDF_BYTES.label}`,
				err instanceof Error ? err : undefined,
			);
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				sirenError({
					code: "pdf-too-large",
					message: `PDF upload exceeded ${MAX_PDF_BYTES.label}`,
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
