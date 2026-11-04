import express from "express";
import request from "supertest";
import { useLoopbackServer } from "@packages/web-test-harness";
import { isPrefetchOrBot, isPrefetchRequest } from "./prefetch-request";

const serve = useLoopbackServer();

function buildApp() {
	const app = express();
	app.get("/article", (req, res) => {
		res.json({ prefetch: isPrefetchRequest(req) });
	});
	return app;
}

describe("isPrefetchRequest", () => {
	it("treats a Sec-Purpose: prefetch request as a prefetch", async () => {
		const response = await request(serve(buildApp())).get("/article").set("Sec-Purpose", "prefetch");

		expect(response.body).toEqual({ prefetch: true });
	});

	it("treats the prefetch;prerender form of Sec-Purpose as a prefetch", async () => {
		const response = await request(serve(buildApp()))
			.get("/article")
			.set("Sec-Purpose", "prefetch;prerender");

		expect(response.body).toEqual({ prefetch: true });
	});

	it("treats the legacy Purpose: prefetch header as a prefetch — the only one a page's own fetch() may set", async () => {
		const response = await request(serve(buildApp())).get("/article").set("Purpose", "prefetch");

		expect(response.body).toEqual({ prefetch: true });
	});

	it("treats a request carrying neither header as a real open", async () => {
		const response = await request(serve(buildApp())).get("/article");

		expect(response.body).toEqual({ prefetch: false });
	});
});

describe("isPrefetchOrBot", () => {
	function buildBotApp() {
		const app = express();
		app.get("/article", (req, res) => {
			res.json({ skipped: isPrefetchOrBot(req) });
		});
		return app;
	}

	it("skips a browser prefetch", async () => {
		const response = await request(serve(buildBotApp())).get("/article").set("Sec-Purpose", "prefetch");

		expect(response.body).toEqual({ skipped: true });
	});

	it("skips a crawler user agent", async () => {
		const response = await request(serve(buildBotApp()))
			.get("/article")
			.set("User-Agent", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");

		expect(response.body).toEqual({ skipped: true });
	});

	it("keeps a reader's own browser open", async () => {
		const response = await request(serve(buildBotApp()))
			.get("/article")
			.set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15");

		expect(response.body).toEqual({ skipped: false });
	});
});
