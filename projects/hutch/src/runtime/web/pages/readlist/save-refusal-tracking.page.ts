
import type { Router } from "express";
import express from "express";
import { initObserveSaveRefusal, } from "../../shared/save-refusal";
import type { ReadlistDependencies } from "./readlist-dependencies.types";
import { SAVE_ROUTE, SAVE_INTENT_PATH, } from "./readlist-shared";

export function initSaveRefusalTrackingRoutes(deps: Pick<
		ReadlistDependencies,
		"recordUngatedAnalyticsEvent" | "now" | "salt"
	>): Router {
	const router = express.Router();

	router.post(
		SAVE_ROUTE.saveArticles,
		initObserveSaveRefusal({
			recordUngatedAnalyticsEvent: deps.recordUngatedAnalyticsEvent,
			now: deps.now,
			salt: deps.salt,
			path: SAVE_INTENT_PATH.saveArticles,
		}),
	);

	router.post(
		SAVE_ROUTE.saveArticle,
		initObserveSaveRefusal({
			recordUngatedAnalyticsEvent: deps.recordUngatedAnalyticsEvent,
			now: deps.now,
			salt: deps.salt,
			path: SAVE_INTENT_PATH.saveArticle,
		}),
	);

	router.post(
		SAVE_ROUTE.save,
		initObserveSaveRefusal({
			recordUngatedAnalyticsEvent: deps.recordUngatedAnalyticsEvent,
			now: deps.now,
			salt: deps.salt,
			path: SAVE_INTENT_PATH.save,
		}),
	);

	router.post(
		SAVE_ROUTE.saveContent,
		initObserveSaveRefusal({
			recordUngatedAnalyticsEvent: deps.recordUngatedAnalyticsEvent,
			now: deps.now,
			salt: deps.salt,
			path: SAVE_INTENT_PATH.saveContent,
		}),
	);

	router.post(
		"/:id/issue-links",
		initObserveSaveRefusal({
			recordUngatedAnalyticsEvent: deps.recordUngatedAnalyticsEvent,
			now: deps.now,
			salt: deps.salt,
			path: "/queue/:id/issue-links",
		}),
	);

	return router;
}
