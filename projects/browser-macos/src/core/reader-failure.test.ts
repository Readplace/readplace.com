import assert from "node:assert/strict";
import { buildFailureDocument, friendlyFailureReason } from "./reader-failure";

describe("friendlyFailureReason", () => {
	it("maps known reasons and passes unknown ones through", () => {
		assert.equal(
			friendlyFailureReason("Invalid URL"),
			"That web address isn't valid.",
		);
		assert.ok(
			friendlyFailureReason("Could not fetch article").includes(
				"couldn't reach",
			),
		);
		assert.equal(friendlyFailureReason("boom"), "boom");
	});
});

describe("buildFailureDocument", () => {
	it("renders a friendly failure page with the host and reason", () => {
		const html = buildFailureDocument({
			url: "https://example.com/x",
			reason: "Could not fetch article",
			css: "body{}",
		});
		assert.ok(html.includes("We couldn't open this in reader view"));
		assert.ok(html.includes("example.com"));
		assert.ok(html.includes("reach this page"));
		assert.ok(html.includes("body{}"));
	});
});
