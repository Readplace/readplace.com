import express, { type Router } from "express";

/** A dependency-free liveness probe: it returns 200 so the deployable boots
 * with at least one mounted route and the deploy has something to smoke-test. */
export function initHealthRoutes(): Router {
	const router = express.Router();

	router.get("/health", (_req, res) => {
		res.status(200).type("text/plain").send("ok");
	});

	return router;
}
