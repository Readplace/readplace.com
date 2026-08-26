import { EventEmitter } from "node:events";
import type { NextFunction, Request, Response } from "express";
import type { HutchLogger } from "@packages/hutch-logger";
import { UserIdSchema } from "@packages/domain/user";
import { type AnalyticsClick, type AnalyticsEvent, type AnalyticsPageview, buildMcpSaveIntentEvent, buildMcpToolCalledEvent, buildSaveIntentEvent, buildSignupAttemptedEvent, classifyBrowser, classifyDeviceClass, createAnalyticsMiddleware, deriveSaveSurface, hashIp, isBotUserAgent, isCountableBrowserRequest, type SignupAttemptedEvent, suppressClickCount, tagPageviewExperiment, type ViewSaveIntentEvent } from "./analytics";
import { SAVE_CLIENTS, SAVE_LINK_SURFACES, SAVE_OUTCOMES, SAVE_SURFACE_QUERY, SAVE_SURFACES, type SaveClient, SIGNUP_OUTCOMES } from "./events";

const NATIVE_APP_USER_AGENT = "Readplace/94 CFNetwork/3860.700.1 Darwin/25.6.0";
const SHARE_EXTENSION_USER_AGENT = "ShareExtension/94 CFNetwork/3860.700.1 Darwin/25.6.0";
const ANDROID_APP_USER_AGENT = "Readplace/1 Android/17";

const OWN_HOST = "readplace.test";

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
	requestContext?: { requestId: string };
	visitorId?: string;
	userId?: string;
}

function createReq(overrides: MockReqOverrides = {}): Partial<Request> {
	const headers: Record<string, string | undefined> = {
		"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/145.0",
		"accept-language": "en-US,en;q=0.9",
		"sec-ch-ua": '"Chromium";v="145", "Google Chrome";v="145", "Not?A_Brand";v="24"',
		"sec-fetch-mode": "navigate",
		"sec-fetch-dest": "document",
		...overrides.headers,
	};
	return {
		method: overrides.method ?? "GET",
		path: overrides.path ?? "/",
		ip: overrides.ip ?? "1.2.3.4",
		query: overrides.query ?? {},
		headers,
		requestContext: overrides.requestContext,
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

function captureEvents(
	req: Partial<Request>,
	res: Response & EventEmitter,
	beforeFinish?: () => void,
	isStaticAssetPath: (path: string) => boolean = () => false,
): AnalyticsEvent[] {
	const { captured, logger } = createCapturingLogger();
	const middleware = createAnalyticsMiddleware({
		logger,
		salt: "test-salt",
		now: () => new Date("2026-04-21T10:00:00.000Z"),
		isStaticAssetPath,
		ownHost: OWN_HOST,
	});
	const next: NextFunction = () => {};
	middleware(req as Request, res, next);
	beforeFinish?.();
	res.emit("finish");
	return captured;
}

function runMiddleware(
	req: Partial<Request>,
	res: Response & EventEmitter,
	isStaticAssetPath?: (path: string) => boolean,
	beforeFinish?: () => void,
): AnalyticsPageview[] {
	return captureEvents(req, res, beforeFinish, isStaticAssetPath).filter(
		(e): e is AnalyticsPageview => e.event === "pageview",
	);
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
			browser: "chrome",
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

	it("carries the experiment arm the route tagged onto the response, so an arm chosen server-side is still counted as an exposure", () => {
		const res = createRes(200);
		const [event] = runMiddleware(createReq({ path: "/" }), res, undefined, () => {
			tagPageviewExperiment(res, { experiment: "homepage-split-e3", variant: "variant-b" });
		});
		expect(event).toMatchObject({
			experiment: "homepage-split-e3",
			experiment_variant: "variant-b",
		});
	});

	it("keeps the visitor's own utm_* alongside the experiment arm, so an inbound campaign still reads as acquisition", () => {
		const res = createRes(200);
		const [event] = runMiddleware(
			createReq({ path: "/", query: { utm_source: "twitter", utm_medium: "social" } }),
			res,
			undefined,
			() => {
				tagPageviewExperiment(res, { experiment: "homepage-split-e3", variant: "variant-a" });
			},
		);
		expect(event).toMatchObject({
			utm_source: "twitter",
			utm_medium: "social",
			experiment: "homepage-split-e3",
			experiment_variant: "variant-a",
		});
	});

	it("omits the experiment keys from the emitted JSON when the route tagged no arm", () => {
		const serialized = JSON.stringify(runMiddleware(createReq({ path: "/" }), createRes(200))[0]);
		expect(serialized).not.toContain("experiment");
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

	it("skips logging /llms-full.txt so the agent-facing full text dump does not count as a pageview or mint a landing_path", () => {
		expect(runMiddleware(createReq({ path: "/llms-full.txt" }), createRes(200))).toEqual([]);
	});

	it("skips logging /auth.md so the machine-readable auth doc does not count as a pageview or mint a landing_path", () => {
		expect(runMiddleware(createReq({ path: "/auth.md" }), createRes(200))).toEqual([]);
	});

	it("skips logging any /.well-known/ path — RFC 8615 reserves the prefix for machine-facing metadata (OAuth discovery, agent skills, MCP server card), never a human page render", () => {
		expect(
			runMiddleware(createReq({ path: "/.well-known/oauth-authorization-server" }), createRes(200)),
		).toEqual([]);
		expect(
			runMiddleware(createReq({ path: "/.well-known/agent-skills/save-link/SKILL.md" }), createRes(200)),
		).toEqual([]);
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

	it("skips logging a request carrying no User-Agent at all — isbot(undefined) is false, so without this the cheapest possible spoof (send no UA) counts as a human", () => {
		expect(runMiddleware(createReq({ headers: { "user-agent": undefined } }), createRes(200))).toEqual([]);
	});

	it("skips logging a request carrying no Accept-Language — every real browser navigation sends one", () => {
		expect(runMiddleware(createReq({ headers: { "accept-language": undefined } }), createRes(200))).toEqual([]);
	});

	it("skips logging a UA claiming Chrome that sends no Sec-CH-UA — Chromium has sent client hints on every navigation since Chrome 89, so the combination is incoherent and identifies the spoofed-Chrome proxy swarm", () => {
		expect(runMiddleware(createReq({ headers: { "sec-ch-ua": undefined } }), createRes(200))).toEqual([]);
	});

	it("skips logging a UA claiming Chromium (no `Chrome/` token) that sends no Sec-CH-UA", () => {
		const req = createReq({
			headers: {
				"user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/145.0 Safari/537.36",
				"sec-ch-ua": undefined,
			},
		});
		expect(runMiddleware(req, createRes(200))).toEqual([]);
	});

	it("still logs a Safari pageview that sends no Sec-CH-UA — the client-hint check fails open for non-Chromium engines, which never send it", () => {
		const req = createReq({
			headers: {
				"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
				"sec-ch-ua": undefined,
			},
		});
		expect(runMiddleware(req, createRes(200))).toHaveLength(1);
	});

	it("skips logging a prefetch (Sec-Purpose: prefetch) — the browser fetched the page speculatively and the human may never see it", () => {
		const req = createReq({ headers: { "sec-purpose": "prefetch;prerender" } });
		expect(runMiddleware(req, createRes(200))).toEqual([]);
	});

	it("still logs a navigation carrying a Sec-Purpose that is not a prefetch — only speculative fetches are dropped, not every request that declares a purpose", () => {
		expect(runMiddleware(createReq({ headers: { "sec-purpose": "navigate" } }), createRes(200))).toHaveLength(1);
	});

	it("skips logging when Sec-Fetch-Mode is not a navigation — a document pageview is a top-level navigation, not a subresource or CORS fetch", () => {
		expect(runMiddleware(createReq({ headers: { "sec-fetch-mode": "cors" } }), createRes(200))).toEqual([]);
	});

	it("skips logging when Sec-Fetch-Dest is not a document", () => {
		expect(runMiddleware(createReq({ headers: { "sec-fetch-dest": "empty" } }), createRes(200))).toEqual([]);
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

	it("stamps browser derived from the same User-Agent as device_class (both read one hoisted userAgent local) so the device-mix pie can slice by browser family", () => {
		const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
		const [event] = runMiddleware(createReq({ headers: { "user-agent": iphone } }), createRes(200));
		expect(event.device_class).toBe("mobile_ios");
		expect(event.browser).toBe("safari");
	});

	it("stamps is_authenticated=1 on the pageview when the request carries an authenticated userId (set upstream by a route handler)", () => {
		const [event] = runMiddleware(createReq({ userId: "user-1" }), createRes(200));
		expect(event.is_authenticated).toBe(1);
	});
});

describe("createAnalyticsMiddleware — asset & path hygiene", () => {
	it("drops a request the injected isStaticAssetPath flags — asset classification is supplied by the host app (hutch's static routes), not built into the shared middleware", () => {
		const events = runMiddleware(
			createReq({ path: "/client-dist/toast.client.js" }),
			createRes(200),
			(path) => path.startsWith("/client-dist/"),
		);
		expect(events).toEqual([]);
	});

	it("logs a path the injected isStaticAssetPath does not flag, even one ending in a file extension — extension alone never drops a pageview", () => {
		const [event] = runMiddleware(createReq({ path: "/view/fagnerbrack.com/photo.png" }), createRes(200));
		expect(event.path).toBe("/view/fagnerbrack.com/photo.png");
	});

	it("does not count a 301 redirect leg as a pageview — the destination logs its own", () => {
		expect(runMiddleware(createReq({ path: "/view/https:/example.com/post" }), createRes(301))).toEqual([]);
	});

	it("does not count a 302 redirect leg as a pageview", () => {
		expect(runMiddleware(createReq({ path: "/view" }), createRes(302))).toEqual([]);
	});

	it("does not count an informational 1xx response as a pageview", () => {
		expect(runMiddleware(createReq({ path: "/queue" }), createRes(199))).toEqual([]);
	});

	it("counts a 304 Not Modified as a pageview — a conditional revalidation re-displays the reader's cached copy of the page (a real revisit), so unlike a 3xx redirect leg it is a human page render", () => {
		const pageviews = runMiddleware(createReq({ path: "/view/fagnerbrack.com/learn-sql" }), createRes(304));
		expect(pageviews).toHaveLength(1);
		expect(pageviews[0].path).toBe("/view/fagnerbrack.com/learn-sql");
	});

	it("still drops a 304 that carries hx-request — a reader/summary poll revalidation is excluded by the htmx guard, not the status, so keeping 304 loggable does not readmit poll traffic", () => {
		const req = createReq({ path: "/view/fagnerbrack.com/learn-sql", headers: { "hx-request": "true" } });
		expect(runMiddleware(req, createRes(304))).toEqual([]);
	});

	it("snapshots req.path at middleware entry so a finish-time mount-trim mutation cannot corrupt the logged pageview path", () => {
		const req = createReq({ path: "/view/fagnerbrack.com/learn-sql" });
		const res = createRes(200);
		const pageviews = captureEvents(req, res, () => {
			Object.defineProperty(req, "path", { value: "/fagnerbrack.com/learn-sql", configurable: true });
		}).filter((e): e is AnalyticsPageview => e.event === "pageview");
		expect(pageviews).toHaveLength(1);
		expect(pageviews[0].path).toBe("/view/fagnerbrack.com/learn-sql");
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

	it("still counts a click on a 303 redirect (POST-action → See Other) even though 3xx is no longer a pageview", () => {
		const req = createReq({ method: "POST", path: "/queue/save", query: internalQuery });
		expect(runMiddlewareClicks(req, createRes(303))).toHaveLength(1);
		expect(runMiddleware(req, createRes(303))).toEqual([]);
	});

	it("does not count a click when the response is a 4xx/5xx error", () => {
		expect(runMiddlewareClicks(createReq({ query: internalQuery }), createRes(404))).toEqual([]);
	});

	it("does not count a click when isbot flags the user-agent", () => {
		const req = createReq({ query: internalQuery, headers: { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" } });
		expect(runMiddlewareClicks(req, createRes(200))).toEqual([]);
	});

	it("counts a click carrying the fetch-metadata of a real HTMX request (Sec-Fetch-Mode: cors, Sec-Fetch-Dest: empty) — the navigation-shape gate belongs to pageviews only, and applying it to clicks would silently zero out every boosted click", () => {
		const req = createReq({
			query: internalQuery,
			headers: { "hx-request": "true", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" },
		});
		expect(runMiddlewareClicks(req, createRes(200))).toHaveLength(1);
		expect(runMiddleware(req, createRes(200))).toEqual([]);
	});

	it("does not count a click from a request carrying no User-Agent", () => {
		const req = createReq({ query: internalQuery, headers: { "user-agent": undefined } });
		expect(runMiddlewareClicks(req, createRes(200))).toEqual([]);
	});

	it("does not count a click from a request carrying no Accept-Language", () => {
		const req = createReq({ query: internalQuery, headers: { "accept-language": undefined } });
		expect(runMiddlewareClicks(req, createRes(200))).toEqual([]);
	});

	it("does not count a click from a UA claiming Chrome that sends no Sec-CH-UA, so the click stream stays consistent with the pageview stream", () => {
		const req = createReq({ query: internalQuery, headers: { "sec-ch-ua": undefined } });
		expect(runMiddlewareClicks(req, createRes(200))).toEqual([]);
	});

	it("does not count a speculatively prefetched internal link as a click — the browser fetched it, no human pressed it", () => {
		const req = createReq({ query: internalQuery, headers: { "sec-purpose": "prefetch" } });
		expect(runMiddlewareClicks(req, createRes(200))).toEqual([]);
	});

	it("does not count a click when the route suppressed the response — a confirmed-bot fake-success 303 passes the status and UA gates but must not inflate the click stream", () => {
		const req = createReq({ method: "POST", path: "/signup", query: internalQuery });
		const res = createRes(303);
		suppressClickCount(res);
		expect(runMiddlewareClicks(req, res)).toEqual([]);
	});

	it("counts a click on an unsuppressed 303 with the same shape, so suppression is what drops the bot's press, not the redirect status", () => {
		const req = createReq({ method: "POST", path: "/signup", query: internalQuery });
		expect(runMiddlewareClicks(req, createRes(303))).toHaveLength(1);
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
			browser: "chrome",
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

	it("returns 'mobile_ios' for our own iPhone-only app, whose CFNetwork User-Agent isbot() reports as a crawler", () => {
		expect(classifyDeviceClass(NATIVE_APP_USER_AGENT)).toBe("mobile_ios");
	});

	it("returns 'mobile_ios' for our own share extension, which carries no iPhone token and would otherwise fall through to desktop", () => {
		expect(classifyDeviceClass(SHARE_EXTENSION_USER_AGENT)).toBe("mobile_ios");
	});

	it("returns 'desktop', not 'mobile_ios', for a desktop browser User-Agent carrying our native token, since the native match is anchored to the whole User-Agent", () => {
		expect(classifyDeviceClass("Mozilla/5.0 (Windows NT 10.0) Chrome/145.0 Readplace/94 CFNetwork/1.0 Darwin/1.0")).toBe("desktop");
	});

	it("returns 'mobile_android' for our own Android app, whose User-Agent carries no Android browser token", () => {
		expect(classifyDeviceClass(ANDROID_APP_USER_AGENT)).toBe("mobile_android");
	});

	it("returns 'bot', not 'mobile_android', for a crawler that merely mentions our Android token, since that match is anchored too", () => {
		expect(classifyDeviceClass("Googlebot/2.1 (+http://www.google.com/bot.html) Readplace/1 Android/17")).toBe("bot");
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

describe("classifyBrowser", () => {
	it("returns 'other' for an absent or empty User-Agent (no signal)", () => {
		expect(classifyBrowser(undefined)).toBe("other");
		expect(classifyBrowser("")).toBe("other");
	});

	it("returns 'other' for a bot User-Agent even though Googlebot's smartphone UA embeds a real Chrome/ token — the isbot guard keeps a crawler from counting as Chrome", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
			),
		).toBe("other");
	});

	it("returns 'other' for our own native clients, which are not browsers and must never report a browser family", () => {
		expect(classifyBrowser(NATIVE_APP_USER_AGENT)).toBe("other");
		expect(classifyBrowser(SHARE_EXTENSION_USER_AGENT)).toBe("other");
	});

	it("returns 'edge' for desktop Edge (Edg/ token on a UA that also carries Chrome/ and Safari/)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
			),
		).toBe("edge");
	});

	it("returns 'edge' for Edge on Android (EdgA/ token, distinct from the desktop Edg/ token)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 EdgA/120.0.0.0",
			),
		).toBe("edge");
	});

	it("returns 'edge' for Edge on iOS (EdgiOS/ token, which also carries a Safari/ token)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/120.0.0.0 Mobile/15E148 Safari/604.1",
			),
		).toBe("edge");
	});

	it("returns 'opera' for desktop Opera (OPR/ token on a Chromium UA)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0",
			),
		).toBe("opera");
	});

	it("returns 'opera' for Opera on iOS (OPiOS/ token, distinct from the desktop OPR/ token)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) OPiOS/16.0.0.0 Mobile/15E148 Safari/9537.53",
			),
		).toBe("opera");
	});

	it("returns 'samsung_internet' for the Samsung Internet browser (SamsungBrowser/ token on a Chromium UA)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
			),
		).toBe("samsung_internet");
	});

	it("returns 'firefox' for desktop Firefox (Firefox/ token, no Chrome/ or Safari/)", () => {
		expect(classifyBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0")).toBe(
			"firefox",
		);
	});

	it("returns 'firefox' for Firefox on iOS (FxiOS/ token, which carries a Safari/ token — matched before Safari)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15",
			),
		).toBe("firefox");
	});

	it("returns 'chrome' for desktop Chrome (Chrome/ token, which also carries Safari/)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			),
		).toBe("chrome");
	});

	it("returns 'chrome' for Chrome on iOS (CriOS/ token, which carries a Safari/ token — matched before Safari)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1",
			),
		).toBe("chrome");
	});

	it("returns 'safari' for desktop Safari (Safari/ token, matched last because every Chromium UA also carries it)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
			),
		).toBe("safari");
	});

	it("returns 'safari' for mobile Safari on an iPhone", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
			),
		).toBe("safari");
	});

	it("returns 'other' for an in-app webview with no browser token (an iOS Facebook webview omits the Safari/ token)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/430.0.0.32.107;FBBV/517973715;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/16.6;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]",
			),
		).toBe("other");
	});
});

const VALID_VISITOR_ID = "550e8400-e29b-41d4-a716-446655440000";

function buildIntent(overrides: { req?: MockReqOverrides; url?: string; pendingSaveId?: string; client?: SaveClient } = {}): ViewSaveIntentEvent {
	return buildSaveIntentEvent(
		{ now: () => new Date("2026-04-21T10:00:00.000Z"), salt: "test-salt" },
		{
			req: createReq(overrides.req ?? { visitorId: VALID_VISITOR_ID }) as Request,
			url: overrides.url ?? "https://example.com/some-article",
			path: "/save",
			surface: SAVE_SURFACES.readerView,
			outcome: SAVE_OUTCOMES.promptedToSignUp,
			client: overrides.client ?? SAVE_CLIENTS.web,
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
			client: "web",
			device_class: "desktop",
			browser: "chrome",
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

	it("leaves article_host and content_class null when the submitted URL does not parse — save surfaces emit view_save_intent even on a URL-validation failure, where the submitted string is not a saveable URL and there is no host to classify", () => {
		const event = buildIntent({ url: "not a url" });
		expect(event).toMatchObject({ article_host: null, content_class: null });
	});

	it("includes pending_save_id when the anonymous prompted-to-sign-up flow threads one, so the later signup joins back to this intent", () => {
		const event = buildIntent({ pendingSaveId: "pending-abc-123" });
		expect(event).toMatchObject({ pending_save_id: "pending-abc-123" });
	});

	it("stamps is_authenticated=1 when the request carries an authenticated userId (the queue save bar and extension save an already-signed-in user)", () => {
		const event = buildIntent({ req: { visitorId: VALID_VISITOR_ID, userId: "user-1" } });
		expect(event.is_authenticated).toBe(1);
	});

	it("carries the same derived device_class and browser the pageview stream already records, so the client behind an anonymous save is identifiable from the event itself instead of a fuzzy timestamp join against an access log that expires", () => {
		const event = buildIntent({
			req: {
				visitorId: VALID_VISITOR_ID,
				headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
			},
		});
		expect(event).toMatchObject({ device_class: "mobile_ios", browser: "safari" });
	});

	it("records device_class and browser as 'other' when the request carries no User-Agent at all, the shape a scripted client sends", () => {
		const event = buildIntent({ req: { visitorId: VALID_VISITOR_ID, headers: { "user-agent": undefined } } });
		expect(event).toMatchObject({ device_class: "other", browser: "other" });
	});

	it("labels a save from our own iPhone app as mobile_ios with no browser family, rather than the desktop its CFNetwork User-Agent would otherwise fall through to", () => {
		const event = buildIntent({ req: { visitorId: VALID_VISITOR_ID, headers: { "user-agent": SHARE_EXTENSION_USER_AGENT } } });
		expect(event).toMatchObject({ device_class: "mobile_ios", browser: "other" });
	});

	it("labels a save from a self-declared crawler as device_class bot — unlike pageview, no bot gate drops a save intent, so the crawler population that produced 3,577 anonymous save prompts stays countable", () => {
		const event = buildIntent({
			req: { visitorId: VALID_VISITOR_ID, headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" } },
		});
		expect(event).toMatchObject({ device_class: "bot", browser: "other" });
	});

	it("never carries the raw User-Agent anywhere in the emitted payload — only the derived class and family, matching the pageview privacy posture", () => {
		const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
		const event = buildIntent({ req: { visitorId: VALID_VISITOR_ID, headers: { "user-agent": userAgent } } });
		expect(JSON.stringify(event)).not.toContain(userAgent);
	});

	it("records the client the caller states, so a save the iOS app made over an extension-shaped route is not filed as a web save", () => {
		expect(buildIntent({ client: SAVE_CLIENTS.iosApp })).toMatchObject({ client: "ios_app" });
		expect(buildIntent({ client: SAVE_CLIENTS.androidApp })).toMatchObject({ client: "android_app" });
		expect(buildIntent({ client: SAVE_CLIENTS.web })).toMatchObject({ client: "web" });
	});

	it("records the API Gateway request id the Lambda adapter attaches to the request, so an event joins its access-log row on an exact key instead of a fuzzy timestamp window that leaves some events unmatched and others ambiguous", () => {
		const event = buildIntent({ req: { visitorId: VALID_VISITOR_ID, requestContext: { requestId: "Abc123=" } } });
		expect(event).toMatchObject({ request_id: "Abc123=" });
	});

	it("never records a client-supplied request-id header — the id comes from the invocation context, which no HTTP request can set, so the same code is unforgeable in Lambda, the dev server and the test app alike", () => {
		const event = buildIntent({
			req: {
				visitorId: VALID_VISITOR_ID,
				headers: { "x-gateway-request-id": "forged", "x-request-id": "forged" },
			},
		});
		expect("request_id" in event).toBe(false);
		expect(JSON.stringify(event)).not.toContain("forged");
	});

	it("records the gateway's own id even when the request also carries a conflicting x-request-id header, which serverless-http lets a client win", () => {
		const event = buildIntent({
			req: {
				visitorId: VALID_VISITOR_ID,
				headers: { "x-request-id": "forged" },
				requestContext: { requestId: "Abc123=" },
			},
		});
		expect(event).toMatchObject({ request_id: "Abc123=" });
	});

	it("omits request_id entirely where there is no gateway — an absent key rather than an empty string a Logs Insights join would treat as a real id", () => {
		expect("request_id" in buildIntent()).toBe(false);
	});

	it("omits request_id when the invocation context carries an empty request id, rather than stamping a blank join key", () => {
		const event = buildIntent({ req: { visitorId: VALID_VISITOR_ID, requestContext: { requestId: "" } } });
		expect("request_id" in event).toBe(false);
	});

	it("throws when the visitor-id middleware has not run (req.visitorId unset) — a save surface must never emit view_save_intent without a visitor identity to join the conversion on", () => {
		expect(() => buildIntent({ req: {} })).toThrow(
			"visitor-id middleware must run before a save surface emits view_save_intent",
		);
	});
});

function buildSignup(overrides: { req?: MockReqOverrides; outcome?: SignupAttemptedEvent["outcome"] } = {}): SignupAttemptedEvent {
	return buildSignupAttemptedEvent(
		{ now: () => new Date("2026-04-21T10:00:00.000Z"), salt: "test-salt" },
		{
			req: createReq(overrides.req ?? { visitorId: VALID_VISITOR_ID }) as Request,
			outcome: overrides.outcome ?? SIGNUP_OUTCOMES.created,
		},
	);
}

describe("buildMcpToolCalledEvent", () => {
	const now = () => new Date("2026-04-21T10:00:00.000Z");
	const userId = UserIdSchema.parse("00000000000000000000000000000001");

	it("builds an mcp_tool_called carrying the tool, outcome, calling client and user, with no article fields for a tool that submits no url", () => {
		const event = buildMcpToolCalledEvent(
			{ now },
			{
				tool: "list_queue",
				outcome: "ok",
				oauthClientId: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm",
				userId,
			},
		);
		expect(event).toEqual({
			stream: "analytics",
			event: "mcp_tool_called",
			timestamp: "2026-04-21T10:00:00.000Z",
			tool: "list_queue",
			outcome: "ok",
			oauth_client_id: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm",
			user_id: userId,
		});
	});

	it("records only the submitted url's host and content class, never the url itself — a saved article's full URL is reading history", () => {
		const event = buildMcpToolCalledEvent(
			{ now },
			{
				tool: "save_link",
				outcome: "ok",
				oauthClientId: "chatgpt",
				userId,
				submittedUrl: "https://example.com/private/draft-42?token=secret",
			},
		);
		expect(event).toMatchObject({ article_host: "example.com", content_class: "third_party" });
		const serialized = JSON.stringify(event);
		expect(serialized).not.toContain("draft-42");
		expect(serialized).not.toContain("secret");
	});

	it("omits article_host and content_class when the submitted url does not parse, so a malformed save still records its outcome", () => {
		const event = buildMcpToolCalledEvent(
			{ now },
			{
				tool: "save_link",
				outcome: "error",
				oauthClientId: "chatgpt",
				userId,
				submittedUrl: "not a url",
			},
		);
		const serialized = JSON.stringify(event);
		expect(serialized).not.toContain("article_host");
		expect(serialized).not.toContain("content_class");
		expect(event).toMatchObject({ outcome: "error" });
	});
});

describe("buildMcpSaveIntentEvent", () => {
	const now = () => new Date("2026-04-21T10:00:00.000Z");

	it("puts an MCP save into the same view_save_intent funnel as every other surface, with no visitor identity because a tool call carries no browser cookie", () => {
		const event = buildMcpSaveIntentEvent(
			{ now },
			{ url: "https://example.com/a", path: "/mcp", outcome: SAVE_OUTCOMES.saved },
		);
		expect(event).toEqual({
			stream: "analytics",
			event: "view_save_intent",
			timestamp: "2026-04-21T10:00:00.000Z",
			path: "/mcp",
			article_host: "example.com",
			content_class: "third_party",
			surface: "mcp",
			outcome: "saved",
			client: "mcp",
			device_class: "other",
			browser: "other",
			visitor_hash: null,
			visitor_id: null,
			is_authenticated: 1,
		});
	});

	it("nulls article_host and content_class when the submitted url does not parse", () => {
		const event = buildMcpSaveIntentEvent(
			{ now },
			{ url: "::not a url::", path: "/mcp", outcome: SAVE_OUTCOMES.error },
		);
		expect(event).toMatchObject({ article_host: null, content_class: null, outcome: "error" });
	});
});

describe("buildSignupAttemptedEvent", () => {
	it("builds a signup_attempted event carrying the terminal outcome, the visitor identity (hash + id) that joins to user_created, and is_authenticated=0 because the signup form is only shown to anonymous visitors", () => {
		const event = buildSignup({ outcome: SIGNUP_OUTCOMES.disposableEmail });
		expect(event).toEqual({
			stream: "analytics",
			event: "signup_attempted",
			timestamp: "2026-04-21T10:00:00.000Z",
			method: "email",
			outcome: "disposable_email",
			visitor_hash: expect.any(String),
			visitor_id: VALID_VISITOR_ID,
			is_authenticated: 0,
		});
	});

	it("stamps visitor_hash as the salted hash of the request ip", () => {
		const event = buildSignup({ req: { visitorId: VALID_VISITOR_ID, ip: "9.9.9.9" } });
		expect(event.visitor_hash).toBe(hashIp({ ip: "9.9.9.9", salt: "test-salt" }));
	});

	it("throws when the visitor-id middleware has not run (req.visitorId unset) — POST /signup must never emit signup_attempted without a visitor identity to join user_created on", () => {
		expect(() => buildSignup({ req: {} })).toThrow(
			"visitor-id middleware must run before POST /signup emits signup_attempted",
		);
	});
});

describe("isCountableBrowserRequest", () => {
	const run = (overrides: MockReqOverrides = {}) =>
		isCountableBrowserRequest({ req: createReq(overrides) as Request, ownHost: OWN_HOST });

	it("counts a request carrying the header set a real browser navigation always sends", () => {
		expect(run()).toBe(true);
	});

	it("drops a self-declared crawler", () => {
		expect(run({ headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" } })).toBe(false);
	});

	it("drops a request with no User-Agent at all, which isbot() alone reports as human", () => {
		expect(run({ headers: { "user-agent": undefined } })).toBe(false);
	});

	it("drops a request with no Accept-Language, which every real browser sends", () => {
		expect(run({ headers: { "accept-language": undefined } })).toBe(false);
	});

	it("drops a User-Agent claiming Chrome that sends no Sec-CH-UA, which Chromium has sent on every navigation since 89", () => {
		expect(run({ headers: { "sec-ch-ua": undefined } })).toBe(false);
	});

	it("keeps a Chromium-family UA spelled Chromium/ rather than Chrome/ honest about Sec-CH-UA too", () => {
		expect(run({ headers: { "user-agent": "Mozilla/5.0 Chromium/145.0", "sec-ch-ua": undefined } })).toBe(false);
	});

	it("counts Safari with no Sec-CH-UA — the client-hints check must fail open for browsers that never send it", () => {
		expect(run({ headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", "sec-ch-ua": undefined } })).toBe(true);
	});

	it("drops a browser prefetch, which is not a visitor deciding to open anything", () => {
		expect(run({ headers: { "sec-purpose": "prefetch;prerender" } })).toBe(false);
	});

	it("drops a request whose Referer is our own host: every response sets Referrer-Policy: no-referrer, so a conforming browser cannot send one", () => {
		expect(run({ headers: { referer: `https://${OWN_HOST}/queue` } })).toBe(false);
	});

	it("counts a genuine inbound referral from another host, whose referrer its own policy governs", () => {
		expect(run({ headers: { referer: "https://fagnerbrack.com/some-post" } })).toBe(true);
	});

	it("counts a request whose Referer does not parse as a URL rather than guessing at its host", () => {
		expect(run({ headers: { referer: "not a url" } })).toBe(true);
	});

	it("counts a non-navigation request shape: navigation is a pageview-only rule, so completing this predicate with it would zero out every HTMX-boosted click", () => {
		expect(run({ headers: { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" } })).toBe(true);
	});

	it("counts our own iOS app, whose CFNetwork User-Agent isbot() reports as a crawler because it starts with \"read\"", () => {
		expect(run({ headers: { "user-agent": NATIVE_APP_USER_AGENT, "sec-ch-ua": undefined } })).toBe(true);
	});

	it("counts our own share extension, so a save from the iPhone share sheet is not silently uncounted", () => {
		expect(run({ headers: { "user-agent": SHARE_EXTENSION_USER_AGENT, "sec-ch-ua": undefined } })).toBe(true);
	});

	it("counts our own Android app, whose User-Agent isbot() reports as a crawler for the same \"read\" prefix", () => {
		expect(run({ headers: { "user-agent": ANDROID_APP_USER_AGENT, "sec-ch-ua": undefined } })).toBe(true);
	});

	it("does not turn the native-client exemption into a blanket bypass: a native User-Agent with no Accept-Language is still rejected", () => {
		expect(run({ headers: { "user-agent": NATIVE_APP_USER_AGENT, "accept-language": undefined } })).toBe(false);
	});

	it("still drops a prefetch and an own-host referral from the native client, which the exemption must not outrank", () => {
		expect(run({ headers: { "user-agent": NATIVE_APP_USER_AGENT, "sec-purpose": "prefetch" } })).toBe(false);
		expect(run({ headers: { "user-agent": NATIVE_APP_USER_AGENT, referer: `https://${OWN_HOST}/queue` } })).toBe(false);
	});
});

describe("isBotUserAgent", () => {
	it("reports a crawler as a bot", () => {
		expect(isBotUserAgent("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(true);
	});

	it("does not report our own iPhone app as a bot, which is the whole reason this predicate exists rather than a bare isbot", () => {
		expect(isBotUserAgent(NATIVE_APP_USER_AGENT)).toBe(false);
	});

	it("does not report our own share extension as a bot, whose User-Agent isbot() happens to spare today and must keep being spared", () => {
		expect(isBotUserAgent(SHARE_EXTENSION_USER_AGENT)).toBe(false);
	});

	it("does not report a real browser as a bot", () => {
		expect(
			isBotUserAgent(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
			),
		).toBe(false);
	});

	it("matches isbot on a missing User-Agent so a caller swapping to this predicate changes nothing but the native-client case", () => {
		expect(isBotUserAgent(undefined)).toBe(false);
	});

	it("still reports our own User-Agent with anything appended to it as a bot, so the exemption cannot be worn by a request that merely opens with it", () => {
		expect(isBotUserAgent(`${NATIVE_APP_USER_AGENT} extra`)).toBe(true);
	});

	it("still reports a User-Agent that merely starts with our product name as a bot", () => {
		expect(isBotUserAgent("ReadplaceBot/94 CFNetwork/3860.700.1 Darwin/25.6.0")).toBe(true);
	});

	it("still reports a build segment that is not the integer CFBundleVersion carries as a bot", () => {
		expect(isBotUserAgent("Readplace/beta CFNetwork/1.0 Darwin/1.0")).toBe(true);
	});
});

describe("deriveSaveSurface", () => {
	function surfaceFor(value: unknown): string {
		return deriveSaveSurface(createReq({ query: { [SAVE_SURFACE_QUERY]: value } }) as Request);
	}

	it.each(SAVE_LINK_SURFACES)("carries through the %s marker a Save link is allowed to declare", (surface) => {
		expect(surfaceFor(surface)).toBe(surface);
	});

	it("records a Save link that declares nothing as unknown, rather than assuming the reader view it used to be hard-coded to", () => {
		expect(deriveSaveSurface(createReq() as Request)).toBe(SAVE_SURFACES.unknown);
	});

	it("records an empty marker as unknown", () => {
		expect(surfaceFor("")).toBe(SAVE_SURFACES.unknown);
	});

	it.each([SAVE_SURFACES.queueSaveBar, SAVE_SURFACES.extension, SAVE_SURFACES.mcp])(
		"refuses %s, a surface the server assigns to its own emissions, so a link claiming it records as unknown",
		(forged) => {
			expect(surfaceFor(forged)).toBe(SAVE_SURFACES.unknown);
		},
	);

	it("records a repeated marker — which express hands over as an array — as unknown", () => {
		expect(surfaceFor([SAVE_SURFACES.readerView, SAVE_SURFACES.homepageHero])).toBe(SAVE_SURFACES.unknown);
	});

	it("records arbitrary junk as unknown", () => {
		expect(surfaceFor("reader_view'; DROP")).toBe(SAVE_SURFACES.unknown);
	});
});
