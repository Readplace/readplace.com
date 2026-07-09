import { EventEmitter } from "node:events";
import type { NextFunction, Request, Response } from "express";
import type { HutchLogger } from "@packages/hutch-logger";
import { type AnalyticsClick, type AnalyticsEvent, type AnalyticsPageview, buildSaveIntentEvent, classifyDeviceClass, createAnalyticsMiddleware, hashIp, type ViewSaveIntentEvent } from "./analytics";
import { SAVE_OUTCOMES, SAVE_SURFACES } from "./events";

function createCapturingLogger(): {
	logger: HutchLogger.Typed<AnalyticsEvent>;
	captured: AnalyticsEvent[];
} {
	const captured: AnalyticsEvent[] = [];
	const logger: HutchLogger.Typed<AnalyticsEvent> = {
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
	visitorId?: string;
	userId?: string;
}

function createReq(overrides: MockReqOverrides = {}): Partial<Request> {
	const headers: Record<string, string | undefined> = {
		"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/145.0",
		...overrides.headers,
	};
	return {
		method: overrides.method ?? "GET",
		path: overrides.path ?? "/",
		ip: overrides.ip ?? "1.2.3.4",
		query: overrides.query ?? {},
		headers,
		visitorId: overrides.visitorId,
		userId: overrides.userId,
		get(name: string): string | undefined { return headers[name.toLowerCase()]; },
	} as Partial<Request>;
}

function createRes(statusCode = 200): Response & EventEmitter {
	const emitter = new EventEmitter() as Response & EventEmitter;
	emitter.statusCode = statusCode;
	return emitter;
}

function captureEvents(req: Partial<Request>, res: Response & EventEmitter): AnalyticsEvent[] {
	const { captured, logger } = createCapturingLogger();
	const middleware = createAnalyticsMiddleware({
		logger,
		salt: "test-salt",
		now: () => new Date("2026-04-21T10:00:00.000Z"),
	});
	const next: NextFunction = () => {};
	middleware(req as Request, res, next);
	res.emit("finish");
	return captured;
}

function runMiddleware(req: Partial<Request>, res: Response & EventEmitter): AnalyticsPageview[] {
	return captureEvents(req, res).filter((e): e is AnalyticsPageview => e.event === "pageview");
}

function runMiddlewareClicks(req: Partial<Request>, res: Response & EventEmitter): AnalyticsClick[] {
	return captureEvents(req, res).filter((e): e is AnalyticsClick => e.event === "click");
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
			device_class: "desktop",
			visitor_hash: expect.any(String),
			visitor_id: null,
			is_authenticated: 0,
		});
	});

	it("carries the first-party visitor_id when the visitor-id middleware has set req.visitorId, so the pageview joins to the conversion stream", () => {
		const req = createReq({ visitorId: "550e8400-e29b-41d4-a716-446655440000" });
		const [event] = runMiddleware(req, createRes(200));
		expect(event.visitor_id).toBe("550e8400-e29b-41d4-a716-446655440000");
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

	it("skips logging /blog/sitemap.xml so the blog's machine sitemap does not count as a pageview", () => {
		expect(runMiddleware(createReq({ path: "/blog/sitemap.xml" }), createRes(200))).toEqual([]);
	});

	it("skips logging /blog/changelog-banner so hutch's own 5-min server-side banner fetch does not pollute blog pageviews", () => {
		expect(runMiddleware(createReq({ path: "/blog/changelog-banner" }), createRes(200))).toEqual([]);
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

	it("stamps device_class derived from the User-Agent so the audience's device mix is countable at pageview scale (bots are already dropped by shouldLog, so a logged pageview is human)", () => {
		const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
		const [event] = runMiddleware(createReq({ headers: { "user-agent": iphone } }), createRes(200));
		expect(event.device_class).toBe("mobile_ios");
	});

	it("stamps is_authenticated=1 on the pageview when the request carries an authenticated userId (set upstream by a route handler)", () => {
		const [event] = runMiddleware(createReq({ userId: "user-1" }), createRes(200));
		expect(event.is_authenticated).toBe(1);
	});
});

describe("createAnalyticsMiddleware — internal click events", () => {
	const internalQuery = { utm_source: "queue", utm_medium: "internal", utm_content: "subscribe" };

	it("emits a click event carrying the section (utm_source) and element (utm_content) for a request stamped utm_medium=internal", () => {
		const req = createReq({ path: "/account", query: internalQuery, visitorId: "550e8400-e29b-41d4-a716-446655440000" });
		const [click] = runMiddlewareClicks(req, createRes(200));
		expect(click).toEqual({
			stream: "analytics",
			event: "click",
			timestamp: "2026-04-21T10:00:00.000Z",
			path: "/account",
			utm_source: "queue",
			utm_medium: "internal",
			utm_content: "subscribe",
			visitor_hash: expect.any(String),
			visitor_id: "550e8400-e29b-41d4-a716-446655440000",
			is_authenticated: 0,
		});
	});

	it("never carries utm_campaign on a click — only the section and element dimensions are tracked", () => {
		const [click] = runMiddlewareClicks(createReq({ query: internalQuery }), createRes(200));
		expect(JSON.stringify(click)).not.toContain("utm_campaign");
	});

	it("stamps is_authenticated=1 on the click when the request carries an authenticated userId", () => {
		const [click] = runMiddlewareClicks(createReq({ query: internalQuery, userId: "user-1" }), createRes(200));
		expect(click.is_authenticated).toBe(1);
	});

	it("captures utm_term on a click so device-tagged reader-view links (queue-card) are sliceable by device", () => {
		const req = createReq({ query: { ...internalQuery, utm_content: "open-article-title", utm_term: "mobile_ios" } });
		const [click] = runMiddlewareClicks(req, createRes(200));
		expect(click).toMatchObject({ utm_content: "open-article-title", utm_term: "mobile_ios" });
	});

	it("drops utm_term from the emitted JSON when the link carries no term (most clicks)", () => {
		const [click] = runMiddlewareClicks(createReq({ query: internalQuery }), createRes(200));
		expect(JSON.stringify(click)).not.toContain("utm_term");
	});

	it("counts an HTMX-boosted navigation as a click even though the pageview path drops hx-request — boosted links are still clicks", () => {
		const req = createReq({ query: internalQuery, headers: { "hx-request": "true" } });
		expect(runMiddlewareClicks(req, createRes(200))).toHaveLength(1);
		expect(runMiddleware(req, createRes(200))).toEqual([]);
	});

	it("counts a POST action (Save / Delete / Mark-read / Logout) as a click even though POST is never a pageview", () => {
		const req = createReq({ method: "POST", path: "/queue/save", query: internalQuery });
		expect(runMiddlewareClicks(req, createRes(200))).toHaveLength(1);
		expect(runMiddleware(req, createRes(200))).toEqual([]);
	});

	it("does not count a click when the response is a 4xx/5xx error", () => {
		expect(runMiddlewareClicks(createReq({ query: internalQuery }), createRes(404))).toEqual([]);
	});

	it("does not count a click when isbot flags the user-agent", () => {
		const req = createReq({ query: internalQuery, headers: { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" } });
		expect(runMiddlewareClicks(req, createRes(200))).toEqual([]);
	});

	it("keeps utm_medium=internal out of the pageview so acquisition dashboards are not diluted by in-site navigation, while still emitting the click", () => {
		const req = createReq({ path: "/account", query: internalQuery });
		const [pageview] = runMiddleware(req, createRes(200));
		const serialized = JSON.stringify(pageview);
		expect(serialized).not.toContain("utm_source");
		expect(serialized).not.toContain("utm_medium");
		expect(serialized).not.toContain("utm_content");
		expect(runMiddlewareClicks(req, createRes(200))).toHaveLength(1);
	});

	it("strips a real-looking acquisition source (utm_source=homepage) from the pageview when the link carries utm_medium=internal, while the click still records section=homepage — a homepage Signup CTA (GET /signup) is in-site navigation, not an external source like hackernews, so it must stay out of the acquisition pageview widgets", () => {
		const conversionLink = { utm_source: "homepage", utm_medium: "internal", utm_content: "founding-card" };
		const [pageview] = runMiddleware(createReq({ path: "/signup", query: conversionLink }), createRes(200));
		expect(pageview).toEqual({
			stream: "analytics",
			event: "pageview",
			timestamp: "2026-04-21T10:00:00.000Z",
			path: "/signup",
			device_class: "desktop",
			visitor_hash: expect.any(String),
			visitor_id: null,
			is_authenticated: 0,
		});
		const [click] = runMiddlewareClicks(createReq({ path: "/signup", query: conversionLink }), createRes(200));
		expect(click).toMatchObject({ utm_source: "homepage", utm_content: "founding-card" });
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

describe("classifyDeviceClass", () => {
	it("returns 'other' for an absent or empty User-Agent (no signal)", () => {
		expect(classifyDeviceClass(undefined)).toBe("other");
		expect(classifyDeviceClass("")).toBe("other");
	});

	it("returns 'bot' for a crawler User-Agent", () => {
		expect(classifyDeviceClass("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe("bot");
	});

	it("returns 'tablet' for an iPad", () => {
		expect(
			classifyDeviceClass(
				"Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1",
			),
		).toBe("tablet");
	});

	it("returns 'tablet' for an Android device whose UA omits the Mobile token", () => {
		expect(
			classifyDeviceClass(
				"Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			),
		).toBe("tablet");
	});

	it("returns 'mobile_ios' for an iPhone", () => {
		expect(
			classifyDeviceClass(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
			),
		).toBe("mobile_ios");
	});

	it("returns 'mobile_ios' for an iPod", () => {
		expect(classifyDeviceClass("Mozilla/5.0 (iPod touch; CPU iPhone OS 16_0 like Mac OS X)")).toBe("mobile_ios");
	});

	it("returns 'mobile_android' for an Android phone (UA carries the Mobile token)", () => {
		expect(
			classifyDeviceClass(
				"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
			),
		).toBe("mobile_android");
	});

	it("returns 'desktop' for a present UA matching no mobile/tablet/bot fingerprint", () => {
		expect(
			classifyDeviceClass(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			),
		).toBe("desktop");
	});
});

const VALID_VISITOR_ID = "550e8400-e29b-41d4-a716-446655440000";

function buildIntent(overrides: { req?: MockReqOverrides; url?: string; pendingSaveId?: string } = {}): ViewSaveIntentEvent {
	return buildSaveIntentEvent(
		{ now: () => new Date("2026-04-21T10:00:00.000Z"), salt: "test-salt" },
		{
			req: createReq(overrides.req ?? { visitorId: VALID_VISITOR_ID }) as Request,
			url: overrides.url ?? "https://example.com/some-article",
			path: "/save",
			surface: SAVE_SURFACES.readerView,
			outcome: SAVE_OUTCOMES.promptedToSignUp,
			pendingSaveId: overrides.pendingSaveId,
		},
	);
}

describe("buildSaveIntentEvent", () => {
	it("builds a view_save_intent with the normalized article_host, surface, outcome and visitor identity — and for an anonymous save with no referer or pending id omits referrer_host/pending_save_id and marks is_authenticated=0", () => {
		const event = buildIntent();
		expect(event).toEqual({
			stream: "analytics",
			event: "view_save_intent",
			timestamp: "2026-04-21T10:00:00.000Z",
			path: "/save",
			article_host: "example.com",
			content_class: "third_party",
			surface: "reader_view",
			outcome: "prompted_to_sign_up",
			visitor_hash: expect.any(String),
			visitor_id: VALID_VISITOR_ID,
			is_authenticated: 0,
		});
		const serialized = JSON.stringify(event);
		expect(serialized).not.toContain("referrer_host");
		expect(serialized).not.toContain("pending_save_id");
	});

	it("includes referrer_host when the request carries a parseable referer — the traffic source, captured separately from article_host", () => {
		const event = buildIntent({
			req: { visitorId: VALID_VISITOR_ID, headers: { referer: "https://news.ycombinator.com/item?id=1" } },
		});
		expect(event).toMatchObject({ referrer_host: "news.ycombinator.com" });
	});

	it("derives content_class from the saved article's own host, never the referrer — arriving from our own site to save a third-party article is still a third-party save", () => {
		const event = buildIntent({
			url: "https://example.com/some-article",
			req: { visitorId: VALID_VISITOR_ID, headers: { referer: "https://readplace.com/queue" } },
		});
		expect(event).toMatchObject({ article_host: "example.com", content_class: "third_party", referrer_host: "readplace.com" });
	});

	it("includes pending_save_id when the anonymous prompted-to-sign-up flow threads one, so the later signup joins back to this intent", () => {
		const event = buildIntent({ pendingSaveId: "pending-abc-123" });
		expect(event).toMatchObject({ pending_save_id: "pending-abc-123" });
	});

	it("stamps is_authenticated=1 when the request carries an authenticated userId (the queue save bar and extension save an already-signed-in user)", () => {
		const event = buildIntent({ req: { visitorId: VALID_VISITOR_ID, userId: "user-1" } });
		expect(event.is_authenticated).toBe(1);
	});

	it("throws when the visitor-id middleware has not run (req.visitorId unset) — a save surface must never emit view_save_intent without a visitor identity to join the conversion on", () => {
		expect(() => buildIntent({ req: {} })).toThrow(
			"visitor-id middleware must run before a save surface emits view_save_intent",
		);
	});
});
