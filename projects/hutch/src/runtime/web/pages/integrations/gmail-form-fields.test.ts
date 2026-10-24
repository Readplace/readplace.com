import assert from "node:assert/strict";
import { gmailLinkFields } from "./gmail-form-fields";

describe("Gmail link fields", () => {
	it("carries the state and tracking, and marks discovery started only once it has started", () => {
		const fields = (discoveryStarted: boolean) =>
			gmailLinkFields({ state: { search: "tl", add: "1" }, discoveryStarted }, "add-newsletters").map(({ name, value }) => `${name}=${value}`);
		assert.deepEqual(fields(false), ["search=tl", "add=1", "utm_source=integrations-gmail", "utm_medium=internal", "utm_content=add-newsletters"]);
		assert.deepEqual(fields(true), ["search=tl", "add=1", "discovery=started", "utm_source=integrations-gmail", "utm_medium=internal", "utm_content=add-newsletters"]);
	});
});
