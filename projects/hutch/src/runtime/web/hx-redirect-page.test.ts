import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { HxRedirectPage, redirectFullPage } from "./hx-redirect-page";

describe("HxRedirectPage", () => {
	it("returns 200 + text/html + HX-Redirect for text/html", () => {
		const parsed = HxRedirectPage("https://checkout.stripe.test/c/pay/cs_test_abc").to(
			"text/html",
		);
		assert.equal(parsed.statusCode, 200);
		assert.equal(parsed.headers["content-type"], "text/html; charset=utf-8");
		assert.equal(parsed.headers["hx-redirect"], "https://checkout.stripe.test/c/pay/cs_test_abc");
		assert.equal(parsed.body, "");
	});

	it("returns 406 for text/markdown — HX-Redirect is HTMX-specific, markdown clients should hit the plain 303 path instead", () => {
		const parsed = HxRedirectPage("https://checkout.stripe.test/c/pay/cs_test_abc").to(
			"text/markdown",
		);
		assert.equal(parsed.statusCode, 406);
		assert.deepEqual(parsed.headers, {});
		assert.equal(parsed.body, "");
	});
});

describe("redirectFullPage", () => {
	const app = express();
	app.post("/go", (req, res) => {
		redirectFullPage(req, res, "/account/plans");
	});

	it("sends HX-Redirect when the request comes from HTMX", async () => {
		const response = await request(app)
			.post("/go")
			.set("HX-Request", "true")
			.set("Accept", "text/html");
		assert.equal(response.status, 200);
		assert.equal(response.headers["hx-redirect"], "/account/plans");
	});

	it("sends a 303 to the url when the request is not from HTMX", async () => {
		const response = await request(app).post("/go");
		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/account/plans");
	});
});
