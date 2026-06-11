import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import request from "supertest";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import { createRateLimitMiddleware, rateLimitKeyFromRequest } from "./rate-limit";

const PROBE_RULE = { limit: 5, windowSeconds: 60 };

function probeAppWith(consumeRateLimit: ConsumeRateLimit) {
	const app = express();
	app.post(
		"/probe",
		createRateLimitMiddleware({ consumeRateLimit, bucket: "login", rule: PROBE_RULE }),
		(_req, res) => {
			res.status(200).type("text/plain").send("through");
		},
	);
	// Express's default error handler console.errors the stack after the
	// response — in jest that lands after the test ends and fails the run.
	app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
		res.status(500).type("text/plain").send(`handled: ${err.message}`);
	});
	return app;
}

describe("rateLimitKeyFromRequest", () => {
	it("uses the socket-derived req.ip as the client key", () => {
		const req: Partial<Request> = { ip: "203.0.113.9" };
		assert.equal(rateLimitKeyFromRequest(req as Request), "203.0.113.9");
	});

	it("collapses requests without a resolvable address onto one shared key", () => {
		const req: Partial<Request> = { ip: undefined };
		assert.equal(rateLimitKeyFromRequest(req as Request), "unknown");
	});
});

describe("createRateLimitMiddleware", () => {
	it("passes an allowed request through with the bucket, client IP and rule", async () => {
		let captured: Parameters<ConsumeRateLimit>[0] | undefined;
		const app = probeAppWith(async (params) => {
			captured = params;
			return { allowed: true };
		});

		const response = await request(app).post("/probe");

		assert.equal(response.status, 200);
		assert.equal(response.text, "through");
		assert(captured, "the limiter must be consulted");
		assert.equal(captured.bucket, "login");
		assert.deepEqual(captured.rule, PROBE_RULE);
		assert.match(captured.key, /127\.0\.0\.1/);
	});

	it("responds 429 with Retry-After when the limiter denies", async () => {
		const app = probeAppWith(async () => ({ allowed: false, retryAfterSeconds: 42 }));

		const response = await request(app).post("/probe");

		assert.equal(response.status, 429);
		assert.equal(response.headers["retry-after"], "42");
		assert.match(response.text, /Too many requests/);
	});

	it("routes limiter failures to the error middleware instead of hanging", async () => {
		const app = probeAppWith(async () => {
			throw new Error("store unavailable");
		});

		const response = await request(app).post("/probe");

		assert.equal(response.status, 500);
		assert.equal(response.text, "handled: store unavailable");
	});
});
