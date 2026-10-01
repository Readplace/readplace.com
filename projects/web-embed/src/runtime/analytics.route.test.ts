import request from "supertest";
import { GlobalNav, HtmxOmitted, initBase } from "@packages/web-shell";
import type { ResolveLogin } from "@packages/web-session";
import type { HutchLogger } from "@packages/hutch-logger";
import type { AnalyticsClick, AnalyticsEvent, AnalyticsPageview } from "@packages/web-analytics";
import { createEmbedApp } from "./app";

const events: AnalyticsEvent[] = [];
const capture: HutchLogger.Typed<AnalyticsEvent> = {
	info: (e) => events.push(e),
	error: (e) => events.push(e),
	warn: (e) => events.push(e),
	debug: (e) => events.push(e),
};

const guestResolver: ResolveLogin = async () => ({ isAuthenticated: false });

const VISITOR_ID = "00000000-0000-4000-8000-000000000000";
const OWN_HOST = "readplace.test";

function makeApp() {
	return createEmbedApp({
		appOrigin: `https://${OWN_HOST}`,
		base: initBase({ staticBaseUrl: "", liveReload: false, renderNav: GlobalNav, htmx: HtmxOmitted }),
		resolveLogin: guestResolver,
		analyticsLogger: capture,
		salt: "test-salt",
		now: () => new Date("2026-07-01T00:00:00.000Z"),
		generateVisitorId: () => VISITOR_ID,
		secureCookies: false,
		ownHost: OWN_HOST,
		edgeSecret: "test-edge-secret",
	});
}

const BROWSER_HEADERS: Record<string, string> = {
	"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
	"Accept-Language": "en-US,en;q=0.9",
	"Sec-CH-UA": '"Chromium";v="145", "Google Chrome";v="145", "Not?A_Brand";v="24"',
	"Sec-Fetch-Mode": "navigate",
	"Sec-Fetch-Dest": "document",
};

function pageviews(): AnalyticsPageview[] {
	return events.filter((e): e is AnalyticsPageview => e.event === "pageview");
}

function clicks(): AnalyticsClick[] {
	return events.filter((e): e is AnalyticsClick => e.event === "click");
}

beforeEach(() => {
	events.length = 0;
});

describe("embed analytics instrumentation", () => {
	it("emits exactly one click event carrying source and content for an internal-tagged GET /embed", async () => {
		const res = await request(makeApp())
			.get("/embed?utm_source=header-nav&utm_medium=internal&utm_content=embed")
			.set(BROWSER_HEADERS);

		expect(res.status).toBe(200);
		expect(clicks()).toHaveLength(1);
		expect(clicks()[0]).toMatchObject({
			utm_source: "header-nav",
			utm_medium: "internal",
			utm_content: "embed",
		});
		expect(pageviews()).toHaveLength(1);
		expect(pageviews()[0].utm_source).toBeUndefined();
	});

	it("emits one pageview for an untagged browser GET /embed", async () => {
		const res = await request(makeApp()).get("/embed").set(BROWSER_HEADERS);

		expect(res.status).toBe(200);
		expect(pageviews()).toHaveLength(1);
		expect(pageviews()[0].path).toBe("/embed");
		expect(clicks()).toHaveLength(0);
	});
});
