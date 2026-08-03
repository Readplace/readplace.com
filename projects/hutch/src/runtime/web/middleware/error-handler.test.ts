import type { NextFunction, Request, Response } from "express";
import type { HutchLogger } from "@packages/hutch-logger";
import { logAndRespondOnError } from "./error-handler";

function handle(err: Error) {
	const errorCalls: string[] = [];
	const logger: HutchLogger = {
		info: () => {},
		error: (...args) => {
			errorCalls.push(String(args[0]));
		},
		warn: () => {},
		debug: () => {},
	};
	const statusMock = jest.fn().mockReturnThis();
	const jsonMock = jest.fn();
	const res: Partial<Response> = { status: statusMock, json: jsonMock };
	const req: Partial<Request> = {};
	const next: NextFunction = jest.fn();

	logAndRespondOnError(logger)(err, req as Request, res as Response, next);

	return { errorCalls, statusMock, jsonMock };
}

function errorWithStatus(statusCode: number): Error {
	return Object.assign(new Error("boom"), { statusCode });
}

describe("logAndRespondOnError", () => {
	it("logs the error and responds with 500 JSON", () => {
		const { errorCalls, statusMock, jsonMock } = handle(new Error("boom"));

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

	it("answers with the status the error carries, so a missing static asset is a 404 rather than a server fault", () => {
		const { statusMock, jsonMock } = handle(errorWithStatus(404));

		expect(statusMock).toHaveBeenCalledWith(404);
		expect(jsonMock).toHaveBeenCalledWith({
			error: "Not Found",
			statusCode: 404,
		});
	});

	it("still logs a carried-status error, so a bundle that genuinely failed to deploy stays visible", () => {
		const { errorCalls } = handle(errorWithStatus(404));

		expect(errorCalls).toHaveLength(1);
		expect(JSON.parse(errorCalls[0]).level).toBe("ERROR");
	});

	it("falls back to the generic label for a status with no standard reason phrase", () => {
		const { statusMock, jsonMock } = handle(errorWithStatus(499));

		expect(statusMock).toHaveBeenCalledWith(499);
		expect(jsonMock).toHaveBeenCalledWith({
			error: "Internal Server Error",
			statusCode: 499,
		});
	});

	it("ignores a status outside the HTTP error range so a stray numeric property cannot set the response code", () => {
		const { statusMock } = handle(errorWithStatus(200));

		expect(statusMock).toHaveBeenCalledWith(500);
	});
});
