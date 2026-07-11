import assert from "node:assert/strict";
import request from "supertest";
import type { Response as SupertestResponse } from "supertest";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import { GlobalNav } from "@packages/web-shell";
import type { ResolveLogin } from "@packages/web-session";
import type { HutchLogger } from "@packages/hutch-logger";
import type { AnalyticsClick, AnalyticsEvent, AnalyticsPageview } from "@packages/web-analytics";
import { createBlogApp } from "./app";
import { initBlogPosts } from "./web/pages/blog/blog.posts";

const events: AnalyticsEvent[] = [];
const capture: HutchLogger.Typed<AnalyticsEvent> = {
	info: (e) => events.push(e),
	error: (e) => events.push(e),
	warn: (e) => events.push(e),
	debug: (e) => events.push(e),
};

const guestResolver: ResolveLogin = async () => ({ isAuthenticated: false });
const authedResolver: ResolveLogin = async (cookieHeader) =>
	cookieHeader === "hutch_sid=valid"
		? { isAuthenticated: true, userId: authenticatedUserIdFrom("user-1"), emailVerified: true }
		: { isAuthenticated: false };

const VISITOR_ID = "00000000-0000-4000-8000-000000000000";
const firstSlug = initBlogPosts().getAllPosts()[0].slug;

function makeApp(resolveLogin: ResolveLogin) {
	return createBlogApp(
		{ staticBaseUrl: "", liveReload: false, renderNav: GlobalNav },
		{
			resolveLogin,
			analyticsLogger: capture,
			salt: "test-salt",
			now: () => new Date("2026-07-01T00:00:00.000Z"),
			generateVisitorId: () => VISITOR_ID,
			secureCookies: false,
		},
	);
}

function setCookieHeaders(res: SupertestResponse): string[] {
	const raw = res.headers["set-cookie"];
	if (!raw) return [];
	return Array.isArray(raw) ? raw : [raw];
}

function cookieNames(headers: string[]): string[] {
	return headers.map((h) => h.slice(0, h.indexOf("=")));
}

function rawCookieValue(headers: string[], name: string): string | undefined {
	const prefix = `${name}=`;
	const found = headers.find((h) => h.startsWith(prefix));
	if (!found) return undefined;
	return found.slice(prefix.length).split(";")[0];
}

function parseClickCookie(headers: string[]): Record<string, unknown> {
	const value = rawCookieValue(headers, "hutch_click");
	assert.ok(value, "expected a hutch_click cookie to be set");
	return JSON.parse(decodeURIComponent(value));
}

function pageviews(): AnalyticsPageview[] {
	return events.filter((e): e is AnalyticsPageview => e.event === "pageview");
}

function clicks(): AnalyticsClick[] {
	return events.filter((e): e is AnalyticsClick => e.event === "click");
}

beforeEach(() => {
	events.length = 0;
});

describe("blog analytics instrumentation", () => {
	it("emits one pageview and mints hutch_vid + hutch_click on a first landing carrying utm_source", async () => {
		const res = await request(makeApp(guestResolver)).get("/blog?utm_source=hn");

		expect(res.status).toBe(200);
		expect(pageviews()).toHaveLength(1);
		const [pv] = pageviews();
		expect(pv.path).toBe("/blog");
		expect(pv.utm_source).toBe("hn");
		expect(pv.is_authenticated).toBe(0);
		expect(pv.visitor_id).toBe(VISITOR_ID);
		expect(typeof pv.visitor_hash).toBe("string");

		const headers = setCookieHeaders(res);
		expect(cookieNames(headers)).toEqual(expect.arrayContaining(["hutch_vid", "hutch_click"]));
		const click = parseClickCookie(headers);
		expect(click.landing_path).toBe("/blog");
		expect(click.utm_source).toBe("hn");
	});

	it("reuses the visitor id from the replayed hutch_vid cookie and mints no new hutch_vid", async () => {
		const res = await request(makeApp(guestResolver)).get("/blog").set("Cookie", `hutch_vid=${VISITOR_ID}`);

		expect(res.status).toBe(200);
		expect(pageviews()[0].visitor_id).toBe(VISITOR_ID);
		expect(cookieNames(setCookieHeaders(res))).not.toContain("hutch_vid");
	});

	it("records an internal-medium link as a click and strips its utm_source from the pageview", async () => {
		const res = await request(makeApp(guestResolver)).get(
			`/blog/${firstSlug}?utm_source=changelog-banner&utm_medium=internal&utm_content=read-more`,
		);

		expect(res.status).toBe(200);
		expect(clicks()).toHaveLength(1);
		expect(clicks()[0]).toMatchObject({
			utm_source: "changelog-banner",
			utm_medium: "internal",
			utm_content: "read-more",
		});
		expect(pageviews()).toHaveLength(1);
		expect(pageviews()[0].utm_source).toBeUndefined();
	});

	it("emits nothing for a crawler user-agent", async () => {
		const res = await request(makeApp(guestResolver))
			.get("/blog?utm_source=hn")
			.set("User-Agent", "Googlebot/2.1 (+http://www.google.com/bot.html)");

		expect(res.status).toBe(200);
		expect(events).toHaveLength(0);
	});

	it("skips the blog sitemap and the changelog-banner fragment so machine traffic is not counted", async () => {
		await request(makeApp(guestResolver)).get("/blog/sitemap.xml");
		await request(makeApp(guestResolver)).get("/blog/changelog-banner");

		expect(events).toHaveLength(0);
	});

	it("400s a utm value carrying an apostrophe and records nothing — neither a pageview nor the hutch_click cookie", async () => {
		const res = await request(makeApp(guestResolver)).get("/blog?utm_source='");

		expect(res.status).toBe(400);
		expect(events).toHaveLength(0);
		expect(cookieNames(setCookieHeaders(res))).not.toContain("hutch_click");
	});

	it("captures an external referrer in hutch_click but drops a same-host referrer", async () => {
		const external = await request(makeApp(guestResolver)).get("/blog").set("Referer", "https://www.google.com/");
		expect(parseClickCookie(setCookieHeaders(external)).referrer_host).toBe("www.google.com");

		const sameHost = await request(makeApp(guestResolver)).get("/blog").set("Referer", "http://127.0.0.1/x");
		expect(parseClickCookie(setCookieHeaders(sameHost)).referrer_host).toBeUndefined();
	});

	it("stamps is_authenticated=1 when the session resolves to a user and 0 for a guest", async () => {
		const authed = await request(makeApp(authedResolver)).get("/blog").set("Cookie", "hutch_sid=valid");
		expect(authed.status).toBe(200);
		expect(pageviews()[0].is_authenticated).toBe(1);

		events.length = 0;
		const guest = await request(makeApp(guestResolver)).get("/blog");
		expect(guest.status).toBe(200);
		expect(pageviews()[0].is_authenticated).toBe(0);
	});
});
