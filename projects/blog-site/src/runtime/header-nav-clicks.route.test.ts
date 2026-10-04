import request from "supertest";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { AnalyticsClick, AnalyticsEvent } from "@packages/web-analytics";
import { GlobalNav, HtmxOmitted, type NavItem, buildGuestNavGroups, buildNavGroups } from "@packages/web-shell";
import type { ResolveLogin } from "@packages/web-session";
import { BROWSER_USER_AGENT } from "@packages/web-test-harness";
import { createBlogApp } from "./app";

const OWN_ORIGIN = "https://readplace.com";

const BROWSER_HEADERS: Record<string, string> = {
	"User-Agent": BROWSER_USER_AGENT,
	"Accept-Language": "en-US,en;q=0.9",
	"Sec-CH-UA": '"Chromium";v="145", "Google Chrome";v="145", "Not?A_Brand";v="24"',
	"Sec-Fetch-Mode": "navigate",
	"Sec-Fetch-Dest": "document",
};

const signedIn: ResolveLogin = async () => ({
	isAuthenticated: true,
	userId: authenticatedUserIdFrom("user-1"),
	emailVerified: true,
	sessionExpiresAt: 1_800_000_000,
});

const BLOG_ITEMS = [
	...buildGuestNavGroups(),
	...[false, true].flatMap((accessIsReadOnly) => buildNavGroups({ accessIsReadOnly })),
]
	.flatMap((group) => group.items)
	.filter((item) => new URL(item.href, OWN_ORIGIN).pathname.startsWith("/blog"));

function makeApp(events: AnalyticsEvent[]) {
	const capture: HutchLogger.Typed<AnalyticsEvent> = {
		info: (event) => events.push(event),
		error: (event) => events.push(event),
		warn: (event) => events.push(event),
		debug: (event) => events.push(event),
	};
	return createBlogApp(
		{ staticBaseUrl: "", liveReload: false, renderNav: GlobalNav, htmx: HtmxOmitted },
		{
			resolveLogin: signedIn,
			analyticsLogger: capture,
			salt: "test-salt",
			now: () => new Date("2026-07-01T00:00:00.000Z"),
			generateVisitorId: () => "00000000-0000-4000-8000-000000000000",
			secureCookies: false,
			ownHost: new URL(OWN_ORIGIN).hostname,
			edgeSecret: "",
			appOrigin: OWN_ORIGIN,
		},
	);
}

function clicksFor(events: AnalyticsEvent[], item: NavItem): AnalyticsClick[] {
	return events.filter(
		(event): event is AnalyticsClick =>
			event.event === "click" && event.utm_source === item.trackSource && event.utm_content === item.trackContent,
	);
}

describe("every header nav destination the blog serves records the click its tag promises", () => {
	it("finds the blog destination in the nav", () => {
		expect(BLOG_ITEMS.map((item) => item.key)).toContain("blog");
	});

	it.each(BLOG_ITEMS.map((item) => [item.key, item] as const))("records one click for the %s item", async (_key, item) => {
		const events: AnalyticsEvent[] = [];
		const url = new URL(item.href, OWN_ORIGIN);

		const response = await request(makeApp(events)).get(`${url.pathname}${url.search}`).set(BROWSER_HEADERS);

		expect(response.status).toBe(200);
		expect(clicksFor(events, item)).toHaveLength(1);
	});
});
