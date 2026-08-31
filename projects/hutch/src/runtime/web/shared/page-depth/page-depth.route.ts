import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { buildPageDepthEvent, PAGE_EXIT_KINDS } from "@packages/web-analytics";
import type { AnalyticsEvent } from "@packages/web-analytics";
import type { HutchLogger } from "@packages/hutch-logger";

import { PAGE_DEPTH_EVENT_PATH, PAGE_DEPTH_FIELDS } from "./page-depth-tracking";

/** The page the depth was measured on. Only the pages that render the beacon can
 * report one, so the set is closed here rather than trusting the client to name
 * any path it likes. */
export const PAGE_DEPTH_PATHS = { home: "/" } as const;

const MAX_REPORTED_PIXELS = 1_000_000;

const PixelSchema = z.coerce.number().int().min(0).max(MAX_REPORTED_PIXELS);

const PageDepthQuerySchema = z.object({
	[PAGE_DEPTH_FIELDS.deepest]: PixelSchema,
	[PAGE_DEPTH_FIELDS.height]: PixelSchema,
	[PAGE_DEPTH_FIELDS.viewport]: PixelSchema,
	[PAGE_DEPTH_FIELDS.exit]: z.enum([PAGE_EXIT_KINDS.leftSite, PAGE_EXIT_KINDS.navigatedOnward]),
});

/**
 * Receives the leave-time beacon. It answers 204 whatever the payload says: the
 * browser has already navigated away by the time this runs, so a status nobody
 * reads must not turn a malformed report into an error page in the logs.
 */
export function initPageDepthRoute(deps: {
	analytics: HutchLogger.Typed<AnalyticsEvent>;
	now: () => Date;
	salt: string;
}): Router {
	const router = express.Router();

	router.post(PAGE_DEPTH_EVENT_PATH, (req: Request, res: Response) => {
		const parsed = PageDepthQuerySchema.safeParse(req.query);
		if (parsed.success) {
			deps.analytics.info(
				buildPageDepthEvent(
					{ now: deps.now, salt: deps.salt },
					{
						req,
						path: PAGE_DEPTH_PATHS.home,
						deepestPx: parsed.data[PAGE_DEPTH_FIELDS.deepest],
						pageHeightPx: parsed.data[PAGE_DEPTH_FIELDS.height],
						viewportHeightPx: parsed.data[PAGE_DEPTH_FIELDS.viewport],
						exitKind: parsed.data[PAGE_DEPTH_FIELDS.exit],
					},
				),
			);
		}
		res.status(204).end();
	});

	return router;
}
