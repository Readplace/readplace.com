import type { NextFunction, Request, Response } from "express";
import type { HutchLogger } from "@packages/hutch-logger";

export interface ErrorResponse {
	error: string;
	message?: string;
	statusCode: number;
}

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
		const response: ErrorResponse = {
			error: "Internal Server Error",
			statusCode: 500,
		};
		res.status(response.statusCode).json(response);
	};
};
