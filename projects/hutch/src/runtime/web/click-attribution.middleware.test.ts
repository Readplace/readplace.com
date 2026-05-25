import type { CookieOptions, NextFunction, Request, Response } from "express";
import {
	CLICK_COOKIE_NAME,
	type ClickAttribution,
	createClickAttributionMiddleware,
	readClickAttribution,
} from "./click-attribution.middleware";

interface MockReqOverrides {
	method?: string;
	path?: string;
	hostname?: string;
	query?: Record<string, unknown>;
	headers?: Record<string, string | undefined>;
	cookies?: Record<string, string>;
}

function createReq(overrides: MockReqOverrides = {}): Partial<Request> {
	const headers: Record<string, string | undefined> = { ...overrides.headers };
	return {
		method: overrides.method ?? "GET",
		path: overrides.path ?? "/",
		hostname: overrides.hostname ?? "readplace.com",
		query: overrides.query ?? {},
		headers,
		cookies: overrides.cookies ?? {},
		get(name: string): string | undefined {
			return headers[name.toLowerCase()];
		},
	} as Partial<Request>;
}

interface CapturedCookie {
	name: string;
	value: string;
	options: CookieOptions;
}

function createRes(): { res: Partial<Response>; cookies: CapturedCookie[] } {
	const cookies: CapturedCookie[] = [];
	const res: Partial<Response> = {
		cookie(name: string, value: string, options?: CookieOptions) {
			cookies.push({ name, value, options: options ?? {} });
			return res as Response;
		},
	};
	return { res, cookies };
}

function runMiddleware(req: Partial<Request>): { cookies: CapturedCookie[]; nextCalled: boolean } {
	const { res, cookies } = createRes();
	const middleware = createClickAttributionMiddleware({
		now: () => new Date("2026-05-13T10:00:00.000Z"),
	});
	let nextCalled = false;
	const next: NextFunction = () => {
		nextCalled = true;
	};
	middleware(req as Request, res as Response, next);
	return { cookies, nextCalled };
}

function parseCookieValue(value: string): ClickAttribution {
	return JSON.parse(value) as ClickAttribution;
}

describe("createClickAttributionMiddleware", () => {
	it("captures utm params and writes the click cookie on first hit", () => {
		const req = createReq({
			path: "/blog/launch",
			query: { utm_source: "twitter", utm_medium: "social", utm_campaign: "spring" },
		});
		const { cookies, nextCalled } = runMiddleware(req);

		expect(nextCalled).toBe(true);
		expect(cookies).toHaveLength(1);
		const [cookie] = cookies;
		expect(cookie.name).toBe(CLICK_COOKIE_NAME);
		expect(cookie.options).toMatchObject({
			httpOnly: true,
			sameSite: "lax",
			path: "/",
			maxAge: 30 * 24 * 60 * 60 * 1000,
		});
		expect(parseCookieValue(cookie.value)).toEqual({
			utm_source: "twitter",
			utm_medium: "social",
			utm_campaign: "spring",
			first_seen_at: "2026-05-13T10:00:00.000Z",
			landing_path: "/blog/launch",
		});
	});

	it("captures referrer host when present and external", () => {
		const req = createReq({
			path: "/",
			headers: { referer: "https://news.ycombinator.com/item?id=1" },
		});
		const { cookies } = runMiddleware(req);

		expect(cookies).toHaveLength(1);
		expect(parseCookieValue(cookies[0].value)).toMatchObject({
			referrer_host: "news.ycombinator.com",
			landing_path: "/",
		});
	});

	it("drops self-referrers (internal navigation) so the cookie carries no referrer_host but still records landing_path/first_seen_at", () => {
		const req = createReq({
			path: "/",
			hostname: "readplace.com",
			headers: { referer: "https://readplace.com/blog/something" },
		});
		const { cookies } = runMiddleware(req);

		expect(cookies).toHaveLength(1);
		const value = parseCookieValue(cookies[0].value);
		expect(value).toEqual({
			first_seen_at: "2026-05-13T10:00:00.000Z",
			landing_path: "/",
		});
		expect(JSON.stringify(value)).not.toContain("referrer_host");
	});

	it("drops unparseable referer headers but still writes the bare landing_path / first_seen_at cookie", () => {
		const req = createReq({ headers: { referer: "not a url" } });
		const { cookies } = runMiddleware(req);

		expect(cookies).toHaveLength(1);
		expect(JSON.stringify(parseCookieValue(cookies[0].value))).not.toContain("referrer_host");
	});

	it("writes the cookie even when no utm or referrer attribution is present so organic landings carry landing_path / first_seen_at", () => {
		const req = createReq({ path: "/queue" });
		const { cookies, nextCalled } = runMiddleware(req);

		expect(nextCalled).toBe(true);
		expect(cookies).toHaveLength(1);
		expect(parseCookieValue(cookies[0].value)).toEqual({
			first_seen_at: "2026-05-13T10:00:00.000Z",
			landing_path: "/queue",
		});
	});

	it("skips non-GET requests so form posts can never reset the first-touch cookie", () => {
		const req = createReq({
			method: "POST",
			query: { utm_source: "twitter" },
		});
		const { cookies } = runMiddleware(req);

		expect(cookies).toEqual([]);
	});

	it("preserves the existing cookie when a valid attribution is already set (first-touch wins)", () => {
		const existing: ClickAttribution = {
			utm_source: "hn",
			first_seen_at: "2026-05-01T00:00:00.000Z",
			landing_path: "/",
		};
		const req = createReq({
			query: { utm_source: "twitter" },
			cookies: { [CLICK_COOKIE_NAME]: JSON.stringify(existing) },
		});
		const { cookies } = runMiddleware(req);

		expect(cookies).toEqual([]);
	});

	it("re-writes the cookie when an existing cookie is malformed JSON so a corrupted value never blocks future attribution", () => {
		const req = createReq({
			query: { utm_source: "twitter" },
			cookies: { [CLICK_COOKIE_NAME]: "not-json-{{{" },
		});
		const { cookies } = runMiddleware(req);

		expect(cookies).toHaveLength(1);
		expect(parseCookieValue(cookies[0].value)).toMatchObject({ utm_source: "twitter" });
	});

	it("re-writes the cookie when an existing cookie fails schema validation", () => {
		const req = createReq({
			query: { utm_source: "twitter" },
			cookies: { [CLICK_COOKIE_NAME]: JSON.stringify({ first_seen_at: 12345 }) },
		});
		const { cookies } = runMiddleware(req);

		expect(cookies).toHaveLength(1);
	});

	it("truncates UTM values longer than 256 characters so adversarial params cannot exceed browser cookie limits", () => {
		const longValue = "x".repeat(300);
		const req = createReq({ query: { utm_source: longValue } });
		const { cookies } = runMiddleware(req);

		expect(cookies).toHaveLength(1);
		const value = parseCookieValue(cookies[0].value);
		expect(value.utm_source).toBe("x".repeat(256));
	});

	it("drops empty-string UTM params (utm_source=\"\" is not meaningful) and does not capture them as keys", () => {
		const req = createReq({ query: { utm_source: "", utm_medium: "email" } });
		const { cookies } = runMiddleware(req);

		expect(cookies).toHaveLength(1);
		const value = parseCookieValue(cookies[0].value);
		expect(value).toMatchObject({ utm_medium: "email" });
		expect(JSON.stringify(value)).not.toContain("utm_source");
	});

	it("attribution-less landings emit a cookie whose JSON drops every optional key (only first_seen_at + landing_path on the wire)", () => {
		const req = createReq({ path: "/" });
		const { cookies } = runMiddleware(req);

		const serialized = cookies[0].value;
		expect(serialized).not.toContain("utm_source");
		expect(serialized).not.toContain("utm_medium");
		expect(serialized).not.toContain("utm_campaign");
		expect(serialized).not.toContain("utm_content");
		expect(serialized).not.toContain("referrer_host");
	});
});

describe("readClickAttribution", () => {
	function reqWithCookie(value: unknown): Partial<Request> {
		return createReq({
			cookies:
				typeof value === "string"
					? { [CLICK_COOKIE_NAME]: value }
					: { [CLICK_COOKIE_NAME]: JSON.stringify(value) },
		});
	}

	it("returns undefined when no cookie is set", () => {
		expect(readClickAttribution(createReq() as Request)).toBeUndefined();
	});

	it("returns the parsed attribution when the cookie is valid", () => {
		const attribution: ClickAttribution = {
			utm_source: "twitter",
			first_seen_at: "2026-05-01T00:00:00.000Z",
			landing_path: "/",
		};
		expect(readClickAttribution(reqWithCookie(attribution) as Request)).toEqual(attribution);
	});

	it("returns undefined when the cookie value is not parseable JSON", () => {
		expect(readClickAttribution(reqWithCookie("not-json-{{{") as Request)).toBeUndefined();
	});

	it("returns undefined when the cookie value fails schema validation", () => {
		expect(readClickAttribution(reqWithCookie({ first_seen_at: 12345 }) as Request)).toBeUndefined();
	});
});
