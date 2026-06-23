import request from "supertest";
import { createSubscriptionsApp } from "../app";

describe("GET /subscriptions/health", () => {
	it("returns 200 with a plain-text ok", async () => {
		const response = await request(createSubscriptionsApp()).get("/subscriptions/health");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/plain/);
		expect(response.text).toBe("ok");
	});
});
