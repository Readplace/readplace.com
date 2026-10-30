import assert from "node:assert/strict";
import { isExcludedLink } from "./inbox-email-link.excluded";

describe("isExcludedLink", () => {
	it("excludes a skipped link", () => {
		assert.equal(isExcludedLink({ status: "skipped" }), true);
	});

	it.each(["pending", "crawled", "failed"] as const)("keeps a %s link", (status) => {
		assert.equal(isExcludedLink({ status }), false);
	});
});
