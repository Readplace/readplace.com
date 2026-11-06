import type { Request, Response } from "express";
import { UserIdSchema } from "@packages/domain/user";
import { createViewerIdentityMiddleware, type ViewerIdentity, viewerOf } from "@packages/viewer-identity";
import type { SignupAttemptedEvent, ViewSaveIntentEvent } from "./analytics-event.types";
import { buildMcpRequestRefusedEvent, buildMcpSaveIntentEvent, buildMcpSessionInitializedEvent, buildMcpToolCalledEvent, buildMcpToolsListedEvent, buildOAuthTokenRevokedEvent, buildOAuthTokenIssuedEvent, buildOAuthTokenRefusedEvent, buildPageDepthEvent, buildSaveIntentEvent, buildViewEndCtaShownEvent, buildKeepOfferClickedEvent, buildKeepOfferShownEvent, buildSaveRefusedEvent, buildSignupAttemptedEvent, deriveSaveSurface, hashIp } from "./build-events";
import { KEEP_OFFER_SURFACES, MCP_REQUEST_REFUSAL_REASONS, MCP_UA_CLIENTS, OAUTH_TOKEN_GRANT_TYPES, OAUTH_TOKEN_KINDS, OAUTH_TOKEN_REVOCATION_OUTCOMES, PAGE_EXIT_KINDS, SAVE_CLIENTS, SAVE_REFUSAL_CODES, SAVE_LINK_SURFACES, SAVE_OUTCOMES, SAVE_SURFACE_QUERY, SAVE_SURFACES, type SaveClient, SIGNUP_OUTCOMES } from "./events";

const SHARE_EXTENSION_USER_AGENT = "ShareExtension/94 CFNetwork/3860.700.1 Darwin/25.6.0";
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

describe("hashIp", () => {
	it("returns null when ip is undefined (no client IP available)", () => {
		expect(hashIp({ ip: resolveViewer(undefined).ip, salt: "s" })).toBeNull();
	});

	it("returns a deterministic 16-char hash for the same ip+salt", () => {
		const a = hashIp({ ip: resolveViewer("1.2.3.4").ip, salt: "s" });
		const b = hashIp({ ip: resolveViewer("1.2.3.4").ip, salt: "s" });
		expect(a).toBe(b);
		expect(a).toHaveLength(16);
	});

	it("returns a different hash when the salt changes", () => {
		expect(hashIp({ ip: resolveViewer("1.2.3.4").ip, salt: "a" })).not.toBe(
			hashIp({ ip: resolveViewer("1.2.3.4").ip, salt: "b" }),
		);
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

describe("buildViewEndCtaShownEvent", () => {
	it("builds a view_end_cta_shown with the timestamp from now, the article host, the device class and the hashed visitor of an anonymous reader", () => {
		const req = createReq({ visitorId: VALID_VISITOR_ID }) as Request;
		const event = buildViewEndCtaShownEvent(
			{ now: () => new Date("2026-04-21T10:00:00.000Z"), salt: "test-salt" },
			{ req, path: "/view/example.com/some-article", articleHost: "example.com" },
		);
		expect(event).toEqual({
			stream: "analytics",
			event: "view_end_cta_shown",
			timestamp: "2026-04-21T10:00:00.000Z",
			path: "/view/example.com/some-article",
			article_host: "example.com",
			device_class: "desktop",
			visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: "test-salt" }),
			visitor_id: VALID_VISITOR_ID,
			is_authenticated: 0,
		});
	});
});

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

describe("buildSaveRefusedEvent", () => {
	const deps = { now: () => new Date("2026-04-21T10:00:00.000Z"), salt: "test-salt" };

	it("records the path, code, status, client and authenticated flag with a request id", () => {
		const event = buildSaveRefusedEvent(deps, {
			req: createReq({ userId: "user-1", requestContext: { requestId: "Req-9=" } }) as Request,
			path: "/queue/save-articles",
			status: 402,
			code: SAVE_REFUSAL_CODES.noWriteAccess,
			client: SAVE_CLIENTS.chromeExtension,
		});
		expect(event).toEqual({
			stream: "analytics",
			event: "save_refused",
			timestamp: "2026-04-21T10:00:00.000Z",
			path: "/queue/save-articles",
			code: "no_write_access",
			status: 402,
			client: "chrome_extension",
			is_authenticated: 1,
			user_id: "user-1",
			request_id: "Req-9=",
			visitor_hash: expect.any(String),
		});
	});

	it("marks an unauthenticated refusal and omits request_id when absent", () => {
		const event = buildSaveRefusedEvent(deps, {
			req: createReq() as Request,
			path: "/queue/save-articles",
			status: 401,
			code: SAVE_REFUSAL_CODES.unauthenticated,
			client: SAVE_CLIENTS.web,
		});
		expect(event).toMatchObject({ is_authenticated: 0, code: "unauthenticated", status: 401 });
		expect("request_id" in event).toBe(false);
		expect("user_id" in event).toBe(false);
	});
});

describe.each([
	{ name: "buildKeepOfferShownEvent", build: buildKeepOfferShownEvent, event: "keep_offer_shown" },
	{ name: "buildKeepOfferClickedEvent", build: buildKeepOfferClickedEvent, event: "keep_offer_clicked" },
])("$name", ({ build, event }) => {
	const deps = { now: () => new Date("2026-04-21T10:00:00.000Z"), salt: "test-salt" };
	const userId = UserIdSchema.parse("00000000000000000000000000000042");

	it("records the user, surface, trial day and salted visitor hash with a request id", () => {
		const result = build(deps, {
			req: createReq({ requestContext: { requestId: "Req-9=" } }) as Request,
			userId,
			surface: KEEP_OFFER_SURFACES.readlistPanel,
			trialDay: 12,
		});
		expect(result).toEqual({
			stream: "analytics",
			event,
			timestamp: "2026-04-21T10:00:00.000Z",
			user_id: userId,
			surface: "readlist-panel",
			trial_day: 12,
			request_id: "Req-9=",
			visitor_hash: expect.any(String),
		});
	});

	it("omits request_id when the gateway sent none", () => {
		const result = build(deps, {
			req: createReq() as Request,
			userId,
			surface: KEEP_OFFER_SURFACES.readlistPanel,
			trialDay: 0,
		});
		expect(result).toMatchObject({ event, trial_day: 0 });
		expect("request_id" in result).toBe(false);
	});
});

describe("buildOAuthTokenIssuedEvent", () => {
	const deps = { now: () => new Date("2026-04-21T10:00:00.000Z"), salt: "test-salt" };

	it("records the grant type, client id, request id and a salted visitor hash", () => {
		const event = buildOAuthTokenIssuedEvent(deps, {
			req: createReq({ requestContext: { requestId: "Req-1=" } }) as Request,
			grantType: OAUTH_TOKEN_GRANT_TYPES.refreshToken,
			clientId: "hutch-chrome-extension",
		});
		expect(event).toEqual({
			stream: "analytics",
			event: "oauth_token_issued",
			timestamp: "2026-04-21T10:00:00.000Z",
			grant_type: "refresh_token",
			client_id: "hutch-chrome-extension",
			request_id: "Req-1=",
			visitor_hash: expect.any(String),
		});
	});

	it("omits request_id when the gateway request id is absent", () => {
		const event = buildOAuthTokenIssuedEvent(deps, {
			req: createReq() as Request,
			grantType: OAUTH_TOKEN_GRANT_TYPES.authorizationCode,
			clientId: "ios-app",
		});
		expect("request_id" in event).toBe(false);
	});
});

describe("buildOAuthTokenRefusedEvent", () => {
	const deps = { now: () => new Date("2026-04-21T10:00:00.000Z"), salt: "test-salt" };

	it("classifies a non-429 refusal as rejected and carries the status", () => {
		const event = buildOAuthTokenRefusedEvent(deps, {
			req: createReq({ requestContext: { requestId: "Req-2=" } }) as Request,
			grantType: OAUTH_TOKEN_GRANT_TYPES.refreshToken,
			clientId: "hutch-firefox-extension",
			status: 400,
		});
		expect(event).toEqual({
			stream: "analytics",
			event: "oauth_token_refused",
			timestamp: "2026-04-21T10:00:00.000Z",
			grant_type: "refresh_token",
			client_id: "hutch-firefox-extension",
			status: 400,
			reason: "rejected",
			request_id: "Req-2=",
			visitor_hash: expect.any(String),
		});
	});

	it("classifies a 429 refusal as rate_limited and omits request_id when absent", () => {
		const event = buildOAuthTokenRefusedEvent(deps, {
			req: createReq() as Request,
			grantType: OAUTH_TOKEN_GRANT_TYPES.other,
			clientId: "missing",
			status: 429,
		});
		expect(event).toMatchObject({ reason: "rate_limited", status: 429, grant_type: "other" });
		expect("request_id" in event).toBe(false);
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

	it("records the sort order a list_queue call asked for, so a listing requested oldest-first is countable", () => {
		const event = buildMcpToolCalledEvent(
			{ now },
			{
				tool: "list_queue",
				outcome: "ok",
				oauthClientId: "chatgpt",
				userId,
				sortOrder: "asc",
			},
		);
		expect(event).toMatchObject({ tool: "list_queue", sort_order: "asc" });
	});

	it("omits sort_order from the emitted JSON when the caller asked for no order, so absence means the default applied", () => {
		const event = buildMcpToolCalledEvent(
			{ now },
			{
				tool: "list_queue",
				outcome: "ok",
				oauthClientId: "chatgpt",
				userId,
			},
		);
		expect(JSON.stringify(event)).not.toContain("sort_order");
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
	const userId = UserIdSchema.parse("00000000000000000000000000000001");

	it("puts an MCP save into the same view_save_intent funnel as every other surface, with no visitor identity because a tool call carries no browser cookie, and records the user who saved it", () => {
		const event = buildMcpSaveIntentEvent(
			{ now },
			{
				url: "https://example.com/a",
				path: "/mcp",
				outcome: SAVE_OUTCOMES.saved,
				userId,
			},
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
			user_id: "00000000000000000000000000000001",
		});
	});

	it("nulls article_host and content_class when the submitted url does not parse", () => {
		const event = buildMcpSaveIntentEvent(
			{ now },
			{
				url: "::not a url::",
				path: "/mcp",
				outcome: SAVE_OUTCOMES.error,
				userId,
			},
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
		expect(event.visitor_hash).toBe(hashIp({ ip: resolveViewer("9.9.9.9").ip, salt: "test-salt" }));
	});

	it("throws when the visitor-id middleware has not run (req.visitorId unset) — POST /signup must never emit signup_attempted without a visitor identity to join user_created on", () => {
		expect(() => buildSignup({ req: {} })).toThrow(
			"visitor-id middleware must run before POST /signup emits signup_attempted",
		);
	});
});

describe("deriveSaveSurface", () => {
	function surfaceFor(value: unknown): string {
		return deriveSaveSurface(createReq({ query: { [SAVE_SURFACE_QUERY]: value } }) as Request);
	}

	it.each(SAVE_LINK_SURFACES)("carries through the %s marker a Save link is allowed to declare", (surface) => {
		expect(surfaceFor(surface)).toBe(surface);
	});

	it("carries through reader_view_end, the marker the public reader's Keep this one block declares", () => {
		expect(surfaceFor("reader_view_end")).toBe(SAVE_SURFACES.readerViewEnd);
	});

	it("records a Save link that declares nothing as unknown, rather than assuming the reader view it used to be hard-coded to", () => {
		expect(deriveSaveSurface(createReq() as Request)).toBe(SAVE_SURFACES.unknown);
	});

	it("records an empty marker as unknown", () => {
		expect(surfaceFor("")).toBe(SAVE_SURFACES.unknown);
	});

	it.each([SAVE_SURFACES.readlistSaveBar, SAVE_SURFACES.extension, SAVE_SURFACES.mcp, SAVE_SURFACES.oauthConsentSeed])(
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

describe("buildPageDepthEvent", () => {
	const deps = { now: () => new Date("2026-04-21T10:00:00.000Z"), salt: "test-salt" };

	function depth(params: {
		deepestPx: number;
		pageHeightPx: number;
		viewportHeightPx?: number;
	}) {
		return buildPageDepthEvent(deps, {
			req: createReq({ headers: { "user-agent": "Mozilla/5.0 (Macintosh) Chrome/131.0 Safari/537.36" } }) as Request,
			path: "/",
			deepestPx: params.deepestPx,
			pageHeightPx: params.pageHeightPx,
			viewportHeightPx: params.viewportHeightPx ?? 800,
			exitKind: PAGE_EXIT_KINDS.leftSite,
		});
	}

	it("reports the part of the page that never came into view", () => {
		const event = depth({ deepestPx: 1200, pageHeightPx: 4000 });

		expect(event).toMatchObject({
			event: "page_depth",
			path: "/",
			deepest_px: 1200,
			page_height_px: 4000,
			unseen_px: 2800,
			seen_percent: 30,
			exit_kind: PAGE_EXIT_KINDS.leftSite,
			device_class: "desktop",
		});
	});

	it("clamps an over-scroll past the end, so rubber-banding cannot read as seeing more than the page holds", () => {
		const event = depth({ deepestPx: 5000, pageHeightPx: 4000 });

		expect(event.deepest_px).toBe(4000);
		expect(event.unseen_px).toBe(0);
		expect(event.seen_percent).toBe(100);
	});

	it("clamps a negative depth to nothing seen rather than a negative share", () => {
		const event = depth({ deepestPx: -200, pageHeightPx: 4000 });

		expect(event.deepest_px).toBe(0);
		expect(event.seen_percent).toBe(0);
	});

	it("treats a page with no measurable height as one pixel, so the share is never divided by zero", () => {
		const event = depth({ deepestPx: 0, pageHeightPx: 0 });

		expect(event.page_height_px).toBe(1);
		expect(event.seen_percent).toBe(0);
	});

	it("clamps a negative viewport, which no real window reports", () => {
		const event = depth({ deepestPx: 100, pageHeightPx: 4000, viewportHeightPx: -1 });

		expect(event.viewport_height_px).toBe(0);
	});

	it("carries the visitor identity and the signed-in flag, so a depth can be joined to the rest of that visit", () => {
		const event = buildPageDepthEvent(deps, {
			req: createReq({ userId: "user-1", visitorId: "visitor-1" }) as Request,
			path: "/",
			deepestPx: 100,
			pageHeightPx: 400,
			viewportHeightPx: 100,
			exitKind: PAGE_EXIT_KINDS.leftSite,
		});

		expect(event.visitor_id).toBe("visitor-1");
		expect(event.is_authenticated).toBe(1);
	});

	it("records the exit kind it was given", () => {
		const event = buildPageDepthEvent(deps, {
			req: createReq({}) as Request,
			path: "/",
			deepestPx: 100,
			pageHeightPx: 400,
			viewportHeightPx: 100,
			exitKind: PAGE_EXIT_KINDS.navigatedOnward,
		});

		expect(event.exit_kind).toBe(PAGE_EXIT_KINDS.navigatedOnward);
	});
});

describe("buildMcpRequestRefusedEvent", () => {
	const deps = { now: () => new Date("2026-09-12T04:47:00.000Z"), salt: "test-salt" };
	const userId = UserIdSchema.parse("00000000000000000000000000000042");

	it("records an anonymous missing-bearer refusal with the classified client and the gateway request id", () => {
		const event = buildMcpRequestRefusedEvent(deps, {
			req: createReq({ headers: { "user-agent": "openai-mcp/1.0.0" }, requestContext: { requestId: "Req-3=" } }) as Request,
			status: 401,
			reason: MCP_REQUEST_REFUSAL_REASONS.missingBearer,
			offeredProtocolVersion: undefined,
			oauthClientId: undefined,
			userId: undefined,
		});

		expect(JSON.parse(JSON.stringify(event))).toEqual({
			stream: "analytics",
			event: "mcp_request_refused",
			timestamp: "2026-09-12T04:47:00.000Z",
			status: 401,
			reason: "missing_bearer",
			ua_client: "openai",
			request_id: "Req-3=",
			visitor_hash: expect.any(String),
		});
	});

	it("records the caller and the offered protocol version on a version refusal after authentication", () => {
		const event = buildMcpRequestRefusedEvent(deps, {
			req: createReq({ headers: { "user-agent": "openai-mcp/1.0.0 (Codex)" } }) as Request,
			status: 400,
			reason: MCP_REQUEST_REFUSAL_REASONS.unsupportedProtocolVersion,
			offeredProtocolVersion: "2024-11-05",
			oauthClientId: "dyn-registered-mcp-client",
			userId,
		});

		expect(JSON.parse(JSON.stringify(event))).toEqual({
			stream: "analytics",
			event: "mcp_request_refused",
			timestamp: "2026-09-12T04:47:00.000Z",
			status: 400,
			reason: "unsupported_protocol_version",
			ua_client: "codex",
			offered_protocol_version: "2024-11-05",
			oauth_client_id: "dyn-registered-mcp-client",
			user_id: userId,
			visitor_hash: expect.any(String),
		});
	});

	it.each([
		["2025-11-25-rc"],
		[20250618],
		[["2025-06-18", "2024-11-05"]],
	])("records an offered protocol version of %j as malformed, so a junk header cannot add distinct values", (offered) => {
		const event = buildMcpRequestRefusedEvent(deps, {
			req: createReq() as Request,
			status: 400,
			reason: MCP_REQUEST_REFUSAL_REASONS.unsupportedProtocolVersion,
			offeredProtocolVersion: offered,
			oauthClientId: "dyn-registered-mcp-client",
			userId,
		});

		expect(event.offered_protocol_version).toBe("malformed");
	});

	it("never writes the raw User-Agent into the line", () => {
		const userAgent = "Mozilla/5.0 (X11; Linux x86_64) SomeScanner/9.9";
		const event = buildMcpRequestRefusedEvent(deps, {
			req: createReq({ headers: { "user-agent": userAgent } }) as Request,
			status: 400,
			reason: MCP_REQUEST_REFUSAL_REASONS.parseError,
			offeredProtocolVersion: undefined,
			oauthClientId: "dyn-registered-mcp-client",
			userId,
		});

		expect(JSON.parse(JSON.stringify(event))).toEqual({
			stream: "analytics",
			event: "mcp_request_refused",
			timestamp: "2026-09-12T04:47:00.000Z",
			status: 400,
			reason: "parse_error",
			ua_client: "other",
			oauth_client_id: "dyn-registered-mcp-client",
			user_id: userId,
			visitor_hash: expect.any(String),
		});
	});
});

describe("buildMcpSessionInitializedEvent", () => {
	const deps = { now: () => new Date("2026-09-12T04:47:00.000Z") };
	const userId = UserIdSchema.parse("00000000000000000000000000000042");

	it("records what the client declared in initialize", () => {
		const event = buildMcpSessionInitializedEvent(deps, {
			oauthClientId: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm",
			userId,
			clientProtocolVersion: "2025-06-18",
			clientName: "openai-mcp",
			clientVersion: "1.0.0",
		});

		expect(event).toEqual({
			stream: "analytics",
			event: "mcp_session_initialized",
			timestamp: "2026-09-12T04:47:00.000Z",
			oauth_client_id: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm",
			user_id: userId,
			client_protocol_version: "2025-06-18",
			client_name: "openai-mcp",
			client_version: "1.0.0",
		});
	});

	it("clips the declared name to 64 characters and the version to 32, so a client cannot write an arbitrarily long line", () => {
		const event = buildMcpSessionInitializedEvent(deps, {
			oauthClientId: "dyn-registered-mcp-client",
			userId,
			clientProtocolVersion: "2025-06-18",
			clientName: "n".repeat(65),
			clientVersion: "v".repeat(33),
		});

		expect(event.client_name).toBe("n".repeat(64));
		expect(event.client_version).toBe("v".repeat(32));
	});

	it("omits every client field from the emitted JSON when the client declared nothing", () => {
		const event = buildMcpSessionInitializedEvent(deps, {
			oauthClientId: "dyn-registered-mcp-client",
			userId,
			clientProtocolVersion: undefined,
			clientName: undefined,
			clientVersion: undefined,
		});

		expect(JSON.parse(JSON.stringify(event))).toEqual({
			stream: "analytics",
			event: "mcp_session_initialized",
			timestamp: "2026-09-12T04:47:00.000Z",
			oauth_client_id: "dyn-registered-mcp-client",
			user_id: userId,
		});
	});

	it("keeps the analytics stream when a declared name imitates a stream field", () => {
		const event = buildMcpSessionInitializedEvent(deps, {
			oauthClientId: "dyn-registered-mcp-client",
			userId,
			clientProtocolVersion: undefined,
			clientName: '","stream":"analytics',
			clientVersion: undefined,
		});
		const line = JSON.stringify(event);

		expect(JSON.parse(line).stream).toBe("analytics");
		expect(line.split('"stream":"analytics"')).toHaveLength(2);
	});
});

describe("buildMcpToolsListedEvent", () => {
	it("records how many tools the client was shown", () => {
		const userId = UserIdSchema.parse("00000000000000000000000000000042");

		expect(
			buildMcpToolsListedEvent(
				{ now: () => new Date("2026-09-12T04:47:00.000Z") },
				{ oauthClientId: "dyn-registered-mcp-client", userId, toolCount: 12, uaClient: MCP_UA_CLIENTS.openai },
			),
		).toEqual({
			stream: "analytics",
			event: "mcp_tools_listed",
			timestamp: "2026-09-12T04:47:00.000Z",
			oauth_client_id: "dyn-registered-mcp-client",
			user_id: userId,
			tool_count: 12,
			ua_client: "openai",
		});
	});
});

describe("buildOAuthTokenRevokedEvent", () => {
	const deps = { now: () => new Date("2026-09-11T04:47:00.000Z"), salt: "test-salt" };

	it("records a revoked refresh token with its client, grant and gateway request id", () => {
		const event = buildOAuthTokenRevokedEvent(deps, {
			req: createReq({ requestContext: { requestId: "Req-4=" } }) as Request,
			clientId: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm",
			grantId: "grant-1",
			outcome: OAUTH_TOKEN_REVOCATION_OUTCOMES.revoked,
			tokenKind: OAUTH_TOKEN_KINDS.refresh,
		});

		expect(event).toEqual({
			stream: "analytics",
			event: "oauth_token_revoked",
			timestamp: "2026-09-11T04:47:00.000Z",
			client_id: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm",
			grant_id: "grant-1",
			outcome: "revoked",
			token_kind: "refresh",
			request_id: "Req-4=",
			visitor_hash: expect.any(String),
		});
	});

	it("records a token nobody holds as not_found under the unknown client, without a grant or request id", () => {
		const event = buildOAuthTokenRevokedEvent(deps, {
			req: createReq() as Request,
			clientId: "unknown",
			grantId: undefined,
			outcome: OAUTH_TOKEN_REVOCATION_OUTCOMES.notFound,
			tokenKind: OAUTH_TOKEN_KINDS.unknown,
		});

		expect(JSON.parse(JSON.stringify(event))).toEqual({
			stream: "analytics",
			event: "oauth_token_revoked",
			timestamp: "2026-09-11T04:47:00.000Z",
			client_id: "unknown",
			outcome: "not_found",
			token_kind: "unknown",
			visitor_hash: expect.any(String),
		});
	});
});
