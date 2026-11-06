import { EventEmitter } from "node:events";
import type { NextFunction, Request, Response } from "express";
import type { Logger } from "@packages/logger";
import { createViewerIdentityMiddleware, type ViewerIdentity, viewerOf } from "@packages/viewer-identity";
import type { AnalyticsClick, AnalyticsEmailClick, AnalyticsEvent, AnalyticsPageview } from "./analytics-event.types";
import { isBotRequest } from "./user-agent";
import { isCountableBrowserRequest, suppressClickCount, tagPageviewExperiment, tagPageviewSortOrder } from "./countable-request";
import { createAnalyticsMiddleware } from "./analytics.middleware";

const NATIVE_APP_USER_AGENT = "Readplace/94 CFNetwork/3860.700.1 Darwin/25.6.0";
const SHARE_EXTENSION_USER_AGENT = "ShareExtension/94 CFNetwork/3860.700.1 Darwin/25.6.0";
const ANDROID_APP_USER_AGENT = "Readplace/1 Android/17";

const OWN_HOST = "readplace.test";

function createCapturingLogger(): {
	logger: Logger.Typed<AnalyticsEvent>;
	captured: AnalyticsEvent[];
} {
	const captured: AnalyticsEvent[] = [];
	const logger: Logger.Typed<AnalyticsEvent> = {
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

function resolveViewer(ip: string | undefined): ViewerIdentity {
	const req: Partial<Request> = { ip, headers: {} };
	createViewerIdentityMiddleware({ edgeSecret: "" })(req as Request, {} as Response, () => {});
	return viewerOf(req as Request);
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
		viewer: resolveViewer(overrides.ip ?? "1.2.3.4"),
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

function runMiddlewareEmailClicks(req: Partial<Request>, res: Response & EventEmitter): AnalyticsEmailClick[] {
	return captureEvents(req, res).filter((e): e is AnalyticsEmailClick => e.event === "email_click");
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
			os_family: "windows",
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
			tagPageviewExperiment(res, { experiment: "homepage", variant: "variant-c" });
		});
		expect(event).toMatchObject({
			experiment: "homepage",
			experiment_variant: "variant-c",
		});
	});

	it("carries the sort order the route tagged onto the response, so a listing rendered oldest-first is distinguishable from the default", () => {
		const res = createRes(200);
		const [event] = runMiddleware(createReq({ path: "/queue" }), res, undefined, () => {
			tagPageviewSortOrder(res, "asc");
		});
		expect(event).toMatchObject({ path: "/queue", sort_order: "asc" });
	});

	it("omits sort_order from the emitted JSON when the route tags no explicit order, so absence means the reader took the default", () => {
		const res = createRes(200);
		const [event] = runMiddleware(createReq({ path: "/queue" }), res, undefined, () => {
			tagPageviewSortOrder(res, undefined);
		});
		expect(JSON.stringify(event)).not.toContain("sort_order");
	});

	it("keeps the visitor's own utm_* alongside the experiment arm, so an inbound campaign still reads as acquisition", () => {
		const res = createRes(200);
		const [event] = runMiddleware(
			createReq({ path: "/", query: { utm_source: "twitter", utm_medium: "social" } }),
			res,
			undefined,
			() => {
				tagPageviewExperiment(res, { experiment: "homepage", variant: "variant-c" });
			},
		);
		expect(event).toMatchObject({
			utm_source: "twitter",
			utm_medium: "social",
			experiment: "homepage",
			experiment_variant: "variant-c",
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

	it("skips logging /blog/changelog-banner so the banner request every page makes after load does not pollute blog pageviews", () => {
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
			device_class: "desktop",
			browser: "chrome",
			os_family: "windows",
			visitor_hash: expect.any(String),
			visitor_id: "550e8400-e29b-41d4-a716-446655440000",
			is_authenticated: 0,
		});
	});

	it("stamps device_class and browser derived from the User-Agent on the click so a control's clicks are sliceable by platform (e.g. who downloads EPUBs on which device)", () => {
		const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
		const req = createReq({ query: { ...internalQuery, utm_content: "download-epub" }, headers: { "user-agent": iphone } });
		const [click] = runMiddlewareClicks(req, createRes(200));
		expect(click).toMatchObject({ utm_content: "download-epub", device_class: "mobile_ios", browser: "safari" });
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
			os_family: "windows",
			visitor_hash: expect.any(String),
			visitor_id: null,
			is_authenticated: 0,
		});
		const [click] = runMiddlewareClicks(createReq({ path: "/signup", query: conversionLink }), createRes(200));
		expect(click).toMatchObject({ utm_source: "homepage", utm_content: "founding-card" });
	});
});

describe("createAnalyticsMiddleware — email click events", () => {
	const emailQuery = {
		utm_source: "queue-digest",
		utm_medium: "email",
		utm_campaign: "pay",
		utm_content: "keep-readplace",
		utm_term: "msg-1",
	};
	const ownHostReferrer = `https://${OWN_HOST}/login?return=%2Faccount%2Fplans`;

	it("emits exactly one email_click carrying the redirect status when an email link lands on a 303, so a signed-out click bounced to login is still counted", () => {
		const req = createReq({ path: "/account/plans", query: emailQuery, visitorId: "550e8400-e29b-41d4-a716-446655440000" });
		expect(captureEvents(req, createRes(303))).toEqual([
			{
				stream: "analytics",
				event: "email_click",
				timestamp: "2026-04-21T10:00:00.000Z",
				path: "/account/plans",
				status_code: 303,
				utm_source: "queue-digest",
				utm_campaign: "pay",
				utm_content: "keep-readplace",
				utm_term: "msg-1",
				device_class: "desktop",
				browser: "chrome",
				visitor_hash: expect.any(String),
				visitor_id: "550e8400-e29b-41d4-a716-446655440000",
				is_authenticated: 0,
				user_id: null,
			},
		]);
	});

	it("emits the email_click alongside the pageview when the email link renders the page directly", () => {
		const events = captureEvents(createReq({ path: "/queue", query: emailQuery }), createRes(200));
		expect(events.map((e) => e.event)).toEqual(["email_click", "pageview"]);
	});

	it("records the signed-in reader on the email_click, so clicks from one send are countable per reader", () => {
		const [click] = runMiddlewareEmailClicks(createReq({ query: emailQuery, userId: "user-1" }), createRes(200));
		expect(click).toMatchObject({ is_authenticated: 1, user_id: "user-1" });
	});

	it("counts a signed-in email hop that carries our own host as referrer, which is how the page after a password login arrives — in-site links carry utm_medium=internal, so a signed-in request bearing the email medium came from the email", () => {
		const req = createReq({ query: emailQuery, userId: "user-1", headers: { referer: ownHostReferrer } });
		const clicks = runMiddlewareEmailClicks(req, createRes(200));
		expect(clicks).toHaveLength(1);
		expect(clicks[0]).toMatchObject({ is_authenticated: 1, user_id: "user-1", status_code: 200 });
	});

	it("does not count an anonymous email click whose referrer is our own host, since no conforming browser sends one", () => {
		const req = createReq({ query: emailQuery, headers: { referer: ownHostReferrer } });
		expect(runMiddlewareEmailClicks(req, createRes(200))).toEqual([]);
	});

	it("does not count an email click when isbot flags the user-agent", () => {
		const req = createReq({ query: emailQuery, headers: { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" } });
		expect(runMiddlewareEmailClicks(req, createRes(200))).toEqual([]);
	});

	it("does not count a speculatively prefetched email link", () => {
		const req = createReq({ query: emailQuery, headers: { "sec-purpose": "prefetch" } });
		expect(runMiddlewareEmailClicks(req, createRes(200))).toEqual([]);
	});

	it("does not count an email click from a request carrying no Accept-Language", () => {
		const req = createReq({ query: emailQuery, headers: { "accept-language": undefined } });
		expect(runMiddlewareEmailClicks(req, createRes(200))).toEqual([]);
	});

	it("does not count an email click from a UA claiming Chrome that sends no Sec-CH-UA", () => {
		const req = createReq({ query: emailQuery, headers: { "sec-ch-ua": undefined } });
		expect(runMiddlewareEmailClicks(req, createRes(200))).toEqual([]);
	});

	it("does not count an email click when the response is a 4xx/5xx error", () => {
		expect(runMiddlewareEmailClicks(createReq({ query: emailQuery }), createRes(404))).toEqual([]);
		expect(runMiddlewareEmailClicks(createReq({ query: emailQuery }), createRes(500))).toEqual([]);
	});

	it("does not count an email click when the route suppressed the response", () => {
		const res = createRes(303);
		suppressClickCount(res);
		expect(runMiddlewareEmailClicks(createReq({ query: emailQuery }), res)).toEqual([]);
	});

	it("keeps the browser gates for a signed-in email hop: the own-host referrer is the only rule the session lifts", () => {
		const signedIn = { query: emailQuery, userId: "user-1" };
		expect(runMiddlewareEmailClicks(createReq({ ...signedIn, headers: { "sec-purpose": "prefetch" } }), createRes(200))).toEqual([]);
		expect(runMiddlewareEmailClicks(createReq({ ...signedIn, headers: { "accept-language": undefined } }), createRes(200))).toEqual([]);
		expect(runMiddlewareEmailClicks(createReq({ ...signedIn, headers: { "sec-ch-ua": undefined } }), createRes(200))).toEqual([]);
		expect(runMiddlewareEmailClicks(createReq(signedIn), createRes(404))).toEqual([]);
		const suppressed = createRes(303);
		suppressClickCount(suppressed);
		expect(runMiddlewareEmailClicks(createReq(signedIn), suppressed)).toEqual([]);
	});

	it("records an email link as an email_click only, never as an internal click", () => {
		expect(runMiddlewareClicks(createReq({ query: emailQuery }), createRes(200))).toEqual([]);
	});

	it("still records an internal link as a click only, never as an email_click", () => {
		const internalQuery = { utm_source: "queue", utm_medium: "internal", utm_content: "subscribe" };
		const events = captureEvents(createReq({ query: internalQuery }), createRes(303));
		expect(events.map((e) => e.event)).toEqual(["click"]);
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

	it("drops a signed-in request with no User-Agent, because isBrowserClient — not the bot sniff the principal now outranks — is what a header-less request fails", () => {
		expect(run({ userId: "user-1", headers: { "user-agent": undefined } })).toBe(false);
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

describe("isBotRequest", () => {
	function botFor(userAgent: string | undefined): boolean {
		return isBotRequest(createReq({ headers: { "user-agent": userAgent } }) as Request);
	}

	function botForSignedIn(userAgent: string | undefined): boolean {
		return isBotRequest(
			createReq({ userId: "user-1", headers: { "user-agent": userAgent } }) as Request,
		);
	}

	it("treats a request that sends no User-Agent as a bot, which is the one place this predicate parts company with isBotUserAgent", () => {
		expect(botFor(undefined)).toBe(true);
	});

	it("treats an empty User-Agent as a bot, since a header present but blank carries no more signal than an absent one", () => {
		expect(botFor("")).toBe(true);
	});

	it("reports a crawler as a bot", () => {
		expect(botFor("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(true);
	});

	it("does not report a request carrying a validated principal as a bot, even when it declares a crawler User-Agent — a proven identity outranks the sniff", () => {
		expect(botForSignedIn("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(false);
	});

	it("does not report a signed-in request that sends no User-Agent as a bot, since a proxy stripping the header cannot unprove the session", () => {
		expect(botForSignedIn(undefined)).toBe(false);
	});

	it("still reports an anonymous request with an empty principal as a bot, which is why this reads truthiness and not just a set property", () => {
		expect(isBotRequest(createReq({ userId: "", headers: { "user-agent": undefined } }) as Request)).toBe(true);
	});

	it("does not report a real browser as a bot", () => {
		expect(
			botFor(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
			),
		).toBe(false);
	});

	it.each([
		["the iPhone app", NATIVE_APP_USER_AGENT],
		["the share extension", SHARE_EXTENSION_USER_AGENT],
		["the Android app", ANDROID_APP_USER_AGENT],
	])("does not report %s as a bot, so a native save still records an audience event", (_name, userAgent) => {
		expect(botFor(userAgent)).toBe(false);
	});
});
