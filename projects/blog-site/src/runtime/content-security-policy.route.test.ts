import { GlobalNav, HtmxOmitted } from "@packages/web-shell";
import request from "supertest";
import { useLoopbackServer } from "@packages/web-test-harness";
import { createBlogApp } from "./app";

const serve = useLoopbackServer();

const app = createBlogApp(
	{ staticBaseUrl: "", liveReload: false, renderNav: GlobalNav, htmx: HtmxOmitted },
	{
		resolveLogin: async () => ({ isAuthenticated: false }),
		analyticsLogger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
		salt: "test-salt",
		now: () => new Date("2026-07-01T00:00:00.000Z"),
		generateVisitorId: () => "00000000-0000-4000-8000-000000000000",
		secureCookies: false,
		ownHost: "readplace.com",
		edgeSecret: "",
		appOrigin: "https://readplace.com",
	},
);

describe("Content-Security-Policy on the blog", () => {
	it("limits framing, plugin elements and base URLs on /blog and leaves script and style sources open", async () => {
		const response = await request(serve(app)).get("/blog").set("Host", "readplace.com");
		expect(response.headers["content-security-policy"]).toBe(
			"frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
		);
	});
});
