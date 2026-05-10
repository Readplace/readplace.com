import { EventEmitter } from "node:events";
import type { NextFunction, Request, Response } from "express";
import type { HutchLogger } from "@packages/hutch-logger";
import { type AnalyticsPageview, createAnalyticsMiddleware, hashIp } from "./analytics";

function createCapturingLogger(): {
	logger: HutchLogger.Typed<AnalyticsPageview>;
	captured: AnalyticsPageview[];
} {
	const captured: AnalyticsPageview[] = [];
	const logger: HutchLogger.Typed<AnalyticsPageview> = {
		info: (data) => { captured.push(data); },
		error: () => {},
		warn: () => {},
		debug: () => {},
	};
	return { logger, captured };
}

interface MockReqOverrides {
	method?: string;
	path?: string;
	ip?: string;
	query?: Record<string, unknown>;
	headers?: Record<string, string | undefined>;
}

function createReq(overrides: MockReqOverrides = {}): Request {
	const headers: Record<string, string | undefined> = {
		"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/145.0",
		...overrides.headers,
	};
	const base = {
		method: overrides.method ?? "GET",
		path: overrides.path ?? "/",
		ip: overrides.ip ?? "1.2.3.4",
		query: overrides.query ?? {},
		headers,
		get(name: string): string | undefined { return headers[name.toLowerCase()]; },
	};
	return base as unknown as Request;
}

function createRes(statusCode = 200): Response & EventEmitter {
	const emitter = new EventEmitter() as Response & EventEmitter;
	emitter.statusCode = statusCode;
	return emitter;
}

function runMiddleware(req: Request, res: Response & EventEmitter): AnalyticsPageview[] {
	const { captured, logger } = createCapturingLogger();
	const middleware = createAnalyticsMiddleware({
		logger,
		salt: "test-salt",
		now: () => new Date("2026-04-21T10:00:00.000Z"),
	});
	const next: NextFunction = () => {};
	middleware(req, res, next);
	res.emit("finish");
	return captured;
}

describe("createAnalyticsMiddleware", () => {
	it("absent UTM/referrer keys are dropped from the emitted JSON — extractQueryString returns undefined (not null) so JSON.stringify omits the key; null would serialize as \"utm_source\":null and waste ~80 bytes on every no-UTM pageview", () => {
		const [event] = runMiddleware(createReq({ path: "/queue" }), createRes(200));
		const serialized = JSON.stringify(event);
		expect(serialized).not.toContain("utm_source");
		expect(serialized).not.toContain("utm_medium");
		expect(serialized).not.toContain("utm_campaign");
		expect(serialized).not.toContain("utm_content");
		expect(serialized).not.toContain("referrer_host");
		expect(serialized).not.toContain("medium_post_id");
		expect(event).toEqual({
			stream: "analytics",
			event: "pageview",
			timestamp: "2026-04-21T10:00:00.000Z",
			path: "/queue",
			visitor_hash: expect.any(String),
			is_authenticated: 0,
		});
	});

	it("includes utm_* keys only for provided params (JSON wire shape, not in-memory object — {utm_campaign: undefined} drops from the JSON but still appears as a key in JS)", () => {
		const req = createReq({ query: { utm_source: "newsletter", utm_medium: "email" } });
		const [event] = runMiddleware(req, createRes(200));
		expect(event).toMatchObject({ utm_source: "newsletter", utm_medium: "email" });
		expect(JSON.stringify(event)).not.toContain("utm_campaign");
	});

	it("includes referrer_host when the referer header parses to a hostname", () => {
		const req = createReq({ headers: { referer: "https://news.ycombinator.com/item?id=1" } });
		const [event] = runMiddleware(req, createRes(200));
		expect(event).toMatchObject({ referrer_host: "news.ycombinator.com" });
	});

	it("omits referrer_host from the emitted JSON when the referer header is not a parseable URL", () => {
		const req = createReq({ headers: { referer: "not a url" } });
		const [event] = runMiddleware(req, createRes(200));
		expect(JSON.stringify(event)).not.toContain("referrer_host");
	});

	it("skips logging for non-GET requests", () => {
		expect(runMiddleware(createReq({ method: "POST" }), createRes(200))).toEqual([]);
	});

	it("skips logging when status is 4xx/5xx", () => {
		expect(runMiddleware(createReq({}), createRes(404))).toEqual([]);
	});

	it("skips logging for paths in the SKIP_PATHS set", () => {
		expect(runMiddleware(createReq({ path: "/robots.txt" }), createRes(200))).toEqual([]);
	});

	it("skips logging when isbot flags the user-agent", () => {
		const req = createReq({ headers: { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" } });
		expect(runMiddleware(req, createRes(200))).toEqual([]);
	});

	it("skips logging for HTMX requests (HX-Request: true) — reader-pending fragment polls every 3s and would otherwise drown the analytics stream", () => {
		const req = createReq({ headers: { "hx-request": "true" } });
		expect(runMiddleware(req, createRes(200))).toEqual([]);
	});

	it("drops empty-string UTM params from the emitted JSON (utm_source=\"\" is not a meaningful source)", () => {
		const req = createReq({ query: { utm_source: "" } });
		const [event] = runMiddleware(req, createRes(200));
		expect(JSON.stringify(event)).not.toContain("utm_source");
	});

	it("extracts the Medium post id from source=post_page-----<id>--- — Medium attaches this to every outbound link from a post and the alnum segment is the canonical post id (same one used at https://medium.com/p/<id>)", () => {
		const req = createReq({
			path: "/view",
			query: { source: "post_page-----b07aa10a0d93---------------------------------------" },
		});
		const [event] = runMiddleware(req, createRes(200));
		expect(event).toMatchObject({ medium_post_id: "b07aa10a0d93" });
	});

	it("omits medium_post_id from the emitted JSON when the source param does not match Medium's post_page-----<id> shape (some Medium URLs carry source=user_profile_page or empty)", () => {
		const req = createReq({ query: { source: "user_profile_page" } });
		const [event] = runMiddleware(req, createRes(200));
		expect(JSON.stringify(event)).not.toContain("medium_post_id");
	});

	it("omits medium_post_id from the emitted JSON when the source param is absent", () => {
		const [event] = runMiddleware(createReq({ query: {} }), createRes(200));
		expect(JSON.stringify(event)).not.toContain("medium_post_id");
	});
});

describe("hashIp", () => {
	it("returns null when ip is undefined (no client IP available)", () => {
		expect(hashIp({ ip: undefined, salt: "s" })).toBeNull();
	});

	it("returns a deterministic 16-char hash for the same ip+salt", () => {
		const a = hashIp({ ip: "1.2.3.4", salt: "s" });
		const b = hashIp({ ip: "1.2.3.4", salt: "s" });
		expect(a).toBe(b);
		expect(a).toHaveLength(16);
	});

	it("returns a different hash when the salt changes", () => {
		expect(hashIp({ ip: "1.2.3.4", salt: "a" })).not.toBe(hashIp({ ip: "1.2.3.4", salt: "b" }));
	});
});
