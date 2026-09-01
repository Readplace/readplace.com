import type { NextFunction, Request, Response } from "express";
import express from "express";
import request from "supertest";
import type { HutchLogger } from "@packages/hutch-logger";
import { logAndRespondOnError } from "./error-handler";

const NOW = new Date("2026-08-31T22:14:33.000Z");
const REQUEST_PATH = "/client-dist/htmx.client.js.map";

function capturingLogger(errorCalls: string[]): HutchLogger {
	return {
		info: () => {},
		error: (...args) => {
			errorCalls.push(String(args[0]));
		},
		warn: () => {},
		debug: () => {},
	};
}

function handle(err: Error) {
	const errorCalls: string[] = [];
	const statusMock = jest.fn().mockReturnThis();
	const jsonMock = jest.fn();
	const res: Partial<Response> = { status: statusMock, json: jsonMock };
	const req: Partial<Request> = { path: REQUEST_PATH };
	const next: NextFunction = jest.fn();

	logAndRespondOnError({ logger: capturingLogger(errorCalls), now: () => NOW })(
		err,
		req as Request,
		res as Response,
		next,
	);

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
		expect(parsed.timestamp).toBe("2026-08-31T22:14:33.000Z");
		expect(parsed.message).toBe("Unhandled error");
		expect(parsed.name).toBe("Error");
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

	it("names the request path, so an errors-table row says which asset failed without decoding the stack", () => {
		const { errorCalls } = handle(errorWithStatus(404));

		expect(JSON.parse(errorCalls[0]).url).toBe(REQUEST_PATH);
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

describe("logAndRespondOnError over a real request", () => {
	function probeApp(errorCalls: string[]) {
		return express()
			.get("/reset-password", (_req, _res, next) => {
				next(new Error("boom"));
			})
			.use(logAndRespondOnError({ logger: capturingLogger(errorCalls), now: () => NOW }));
	}

	it("logs the path alone, so a reset token in the query string never reaches the log", async () => {
		const errorCalls: string[] = [];

		const response = await request(probeApp(errorCalls)).get("/reset-password?token=s3cret");

		expect(response.status).toBe(500);
		expect(JSON.parse(errorCalls[0]).url).toBe("/reset-password");
	});
});
