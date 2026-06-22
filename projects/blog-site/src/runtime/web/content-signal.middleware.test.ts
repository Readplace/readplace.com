import express from "express";
import request from "supertest";
import {
	CONTENT_SIGNAL_VALUE,
	contentSignalMiddleware,
} from "./content-signal.middleware";

function appUnderTest() {
	const app = express();
	app.disable("x-powered-by");
	app.use(contentSignalMiddleware);
	app.all(/.*/, (_req, res) => {
		res.status(200).send("ok");
	});
	return app;
}

describe("contentSignalMiddleware", () => {
	it("sets Content-Signal and Vary: Accept on a GET page request", async () => {
		const response = await request(appUnderTest()).get("/blog");
		expect(response.headers["content-signal"]).toBe(CONTENT_SIGNAL_VALUE);
		expect(response.headers.vary).toBe("Accept");
	});

	it("skips the sitemap (machine metadata, not a page)", async () => {
		const response = await request(appUnderTest()).get("/blog/sitemap.xml");
		expect(response.headers["content-signal"]).toBeUndefined();
		expect(response.headers.vary).toBeUndefined();
	});

	it("skips non-GET requests", async () => {
		const response = await request(appUnderTest()).post("/blog");
		expect(response.headers["content-signal"]).toBeUndefined();
	});

	it("always calls next", async () => {
		const page = await request(appUnderTest()).get("/blog");
		const sitemap = await request(appUnderTest()).get("/blog/sitemap.xml");
		expect(page.status).toBe(200);
		expect(sitemap.status).toBe(200);
	});
});
