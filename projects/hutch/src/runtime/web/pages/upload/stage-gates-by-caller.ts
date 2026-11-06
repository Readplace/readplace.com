import type { RequestHandler } from "express";
import express from "express";

export function initStageGatesByCaller(gates: {
	signedIn: readonly RequestHandler[];
	guest: readonly RequestHandler[];
}): RequestHandler {
	const signedIn = express.Router().use(...gates.signedIn);
	const guest = express.Router().use(...gates.guest);
	return (req, res, next) => {
		(req.userId ? signedIn : guest)(req, res, next);
	};
}
