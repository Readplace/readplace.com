import express from "express";
import request from "supertest";
import { useLoopbackServer } from "@packages/web-test-harness";
import { isPrefetchRequest } from "./prefetch-request";

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
