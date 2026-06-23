import express, { type Express } from "express";
import { initHealthRoutes } from "./health/health.page";

/** Composition root for the subscription service: it owns the single express
 * app that both the dev server and the production Lambda boot, so route wiring
 * lives in one place regardless of entry point. The Stripe webhook receiver and
 * the per-user HTML fragment routes mount here alongside the liveness probe. */
export function createSubscriptionsApp(): Express {
	const app = express();
	app.disable("x-powered-by");
	app.use("/subscriptions", initHealthRoutes());
	return app;
}
