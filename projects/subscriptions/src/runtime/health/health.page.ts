import express, { type Router } from "express";

/** A liveness probe for the subscription service. The fragment and webhook
 * routes land here in later steps; this exists so the project boots and the
 * deploy has something to smoke-test. */
export function initHealthRoutes(): Router {
	const router = express.Router();

	router.get("/health", (_req, res) => {
		res.status(200).type("text/plain").send("ok");
	});

	return router;
}
