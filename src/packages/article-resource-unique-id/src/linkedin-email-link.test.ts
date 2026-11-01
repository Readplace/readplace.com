import assert from "node:assert/strict";
import { toLinkedInPostUrl } from "./linkedin-email-link";

describe("toLinkedInPostUrl", () => {
	it("leaves a link that is not a URL as it is", () => {
		assert.equal(toLinkedInPostUrl("not a url"), "not a url");
	});

	it("leaves an http email link as it is", () => {
		const url = "http://www.linkedin.com/comm/feed/update/urn:li:activity:7000000000000000001";

		assert.equal(toLinkedInPostUrl(url), url);
	});

	it("leaves another host's /comm/feed/update/ path as it is", () => {
		const url = "https://example.com/comm/feed/update/urn:li:activity:7000000000000000001";

		assert.equal(toLinkedInPostUrl(url), url);
	});
});
