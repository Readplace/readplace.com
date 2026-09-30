import { GlobalNav, HtmxOmitted } from "@packages/web-shell";
import request from "supertest";
import { createBlogApp } from "./app";

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

describe("hutch-app.com → readplace.com host redirect on the blog", () => {
	it("redirects a blog request on hutch-app.com to readplace.com", async () => {
		const response = await request(app)
			.get("/blog/best-read-it-later-apps-2026?ref=x")
			.set("Host", "hutch-app.com");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe(
			"https://readplace.com/blog/best-read-it-later-apps-2026?ref=x",
		);
	});

	it("serves a blog request on its own host", async () => {
		const response = await request(app).get("/blog").set("Host", "readplace.com");
		expect(response.status).toBe(200);
	});
});
