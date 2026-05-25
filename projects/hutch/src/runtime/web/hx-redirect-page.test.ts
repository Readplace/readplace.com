import assert from "node:assert/strict";
import { HxRedirectPage } from "./hx-redirect-page";

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
