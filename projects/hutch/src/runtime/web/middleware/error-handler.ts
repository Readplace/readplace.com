import { STATUS_CODES } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";

export interface ErrorResponse {
	error: string;
	message?: string;
	statusCode: number;
}

const CarriedHttpStatus = z.object({
	statusCode: z.number().int().min(400).max(599),
});

export const logAndRespondOnError = (logger: HutchLogger) => {
	return (err: Error, _req: Request, res: Response, _next: NextFunction) => {
		logger.error(
			JSON.stringify({
				level: "ERROR",
				timestamp: new Date().toISOString(),
				message: "Unhandled error",
				stack: err.stack,
			}),
		);
		const carried = CarriedHttpStatus.safeParse(err);
		const statusCode = carried.success ? carried.data.statusCode : 500;
		const reason = STATUS_CODES[statusCode];
		const response: ErrorResponse = {
			error: reason ? reason : "Internal Server Error",
			statusCode,
		};
		res.status(response.statusCode).json(response);
	};
};
