import express, { type Request, type Response, type Router } from "express";
import { SAVE_TIP_EVENT_PATH } from "./save-tip-tracking";

export function initSaveTipEventRoute(): Router {
	const router = express.Router();

	router.post(SAVE_TIP_EVENT_PATH, (_req: Request, res: Response) => {
		res.status(204).end();
	});

	return router;
}
