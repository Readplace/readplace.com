import type { NextFunction, Request, Response } from "express";
import type { HutchLogger } from "@packages/hutch-logger";
import { logAndRespondOnError } from "./error-handler";

describe("logAndRespondOnError", () => {
	it("logs the error and responds with 500 JSON", () => {
		const errorCalls: string[] = [];
		const logger: Partial<HutchLogger> = {
			error: (...args: unknown[]) => {
				errorCalls.push(String(args[0]));
			},
		};
		const statusMock = jest.fn().mockReturnThis();
		const jsonMock = jest.fn();
		const res: Partial<Response> = { status: statusMock, json: jsonMock };
		const req: Partial<Request> = {};
		const next: NextFunction = jest.fn();

		logAndRespondOnError(logger as HutchLogger)(
			new Error("boom"),
			req as Request,
			res as Response,
			next,
		);

		expect(errorCalls).toHaveLength(1);
		const parsed = JSON.parse(errorCalls[0]);
		expect(parsed.level).toBe("ERROR");
		expect(parsed.message).toBe("Unhandled error");
		expect(parsed.stack).toContain("Error: boom");
		expect(statusMock).toHaveBeenCalledWith(500);
		expect(jsonMock).toHaveBeenCalledWith({
			error: "Internal Server Error",
			statusCode: 500,
		});
	});
});
