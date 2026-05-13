import type { NextFunction, Request, Response } from "express";
import type { HutchLogger } from "@packages/hutch-logger";
import { logAndRespondOnError } from "./error-handler";

describe("logAndRespondOnError", () => {
	it("logs the error and responds with 500 JSON", () => {
		const errorCalls: string[] = [];
		const logger = { error: (msg: string) => errorCalls.push(msg) } as unknown as HutchLogger;
		const statusMock = jest.fn().mockReturnThis();
		const jsonMock = jest.fn();
		const res = { status: statusMock, json: jsonMock } as unknown as Response;
		const next = jest.fn() as unknown as NextFunction;

		logAndRespondOnError(logger)(new Error("boom"), {} as Request, res, next);

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
