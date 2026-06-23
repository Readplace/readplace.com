import express from "express";
import request from "supertest";
import { initHealthRoutes } from "./health.page";

function makeApp() {
	const app = express();
	app.use("/subscriptions", initHealthRoutes());
	return app;
}

describe("GET /subscriptions/health", () => {
	it("returns 200 with a plain-text ok", async () => {
		const response = await request(makeApp()).get("/subscriptions/health");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/plain/);
		expect(response.text).toBe("ok");
	});
});
