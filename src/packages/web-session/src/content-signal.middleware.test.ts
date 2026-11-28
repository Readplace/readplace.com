import express from "express";
import request from "supertest";
import { useLoopbackServer } from "@packages/web-test-harness";
import { createContentSignalMiddleware } from "./content-signal.middleware";

const serve = useLoopbackServer();

const VALUE = "search=yes, ai-input=yes, ai-train=no";

function appUnderTest() {
	const app = express();
	app.disable("x-powered-by");
	app.use(createContentSignalMiddleware({ value: VALUE, isNonPage: (path) => path === "/sitemap.xml" }));
	app.all(/.*/, (_req, res) => {
		res.status(200).send("ok");
	});
	return app;
}

describe("createContentSignalMiddleware", () => {
	it("sets the given Content-Signal value on a GET page request", async () => {
		const response = await request(serve(appUnderTest())).get("/");
		expect(response.headers["content-signal"]).toBe(VALUE);
		expect(response.status).toBe(200);
	});

	it("varies on Accept so a CDN keys HTML and markdown separately", async () => {
		const response = await request(serve(appUnderTest())).get("/");
		expect(response.headers.vary).toBe("Accept");
	});

	it("skips Content-Signal and Vary on a non-page path", async () => {
		const response = await request(serve(appUnderTest())).get("/sitemap.xml");
		expect(response.headers["content-signal"]).toBeUndefined();
		expect(response.headers.vary).toBeUndefined();
		expect(response.status).toBe(200);
	});

	it("skips Content-Signal and Vary on non-GET requests", async () => {
		const response = await request(serve(appUnderTest())).post("/");
		expect(response.headers["content-signal"]).toBeUndefined();
		expect(response.headers.vary).toBeUndefined();
		expect(response.status).toBe(200);
	});
});
