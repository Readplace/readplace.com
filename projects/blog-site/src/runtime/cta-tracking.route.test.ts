import request from "supertest";
import { GlobalNav, HtmxOmitted } from "@packages/web-shell";
import type { ResolveLogin } from "@packages/web-session";
import type { HutchLogger } from "@packages/hutch-logger";
import type { AnalyticsEvent } from "@packages/web-analytics";
import { describeUntrackedCtas, findUntrackedCtas } from "@packages/web-test-harness";
import { createBlogApp } from "./app";
import { initBlogPosts } from "./web/pages/blog/blog.posts";

const discard: HutchLogger.Typed<AnalyticsEvent> = {
	info: () => {},
	error: () => {},
	warn: () => {},
	debug: () => {},
};

const guestResolver: ResolveLogin = async () => ({ isAuthenticated: false });

const BROWSER_HEADERS: Record<string, string> = {
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
	"Accept-Language": "en-US,en;q=0.9",
	"Sec-Fetch-Mode": "navigate",
	"Sec-Fetch-Dest": "document",
};

const POST_BODY_REGIONS = [".blog-post__content"];

function makeApp() {
	return createBlogApp(
		{ staticBaseUrl: "", liveReload: false, renderNav: GlobalNav, htmx: HtmxOmitted },
		{
			resolveLogin: guestResolver,
			analyticsLogger: discard,
			salt: "test-salt",
			now: () => new Date("2026-07-01T00:00:00.000Z"),
			generateVisitorId: () => "00000000-0000-4000-8000-000000000000",
			secureCookies: false,
			ownHost: "readplace.test",
			edgeSecret: "",
		},
	);
}

describe("every same-origin CTA carries its own utm_source", () => {
	it("holds across the blog chrome, outside a post's own prose", async () => {
		const app = makeApp();
		const paths = ["/blog", `/blog/${initBlogPosts().getAllPosts()[0].slug}`, "/blog/no-such-post"];

		const untracked: string[] = [];
		for (const path of paths) {
			const response = await request(app).get(path).set(BROWSER_HEADERS);
			const found = findUntrackedCtas(response.text, { skipSelectors: POST_BODY_REGIONS });
			for (const line of describeUntrackedCtas(found)) untracked.push(`${path}  ${line}`);
		}

		expect(untracked).toEqual([]);
	});
});
