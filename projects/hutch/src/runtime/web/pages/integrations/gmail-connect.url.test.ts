import assert from "node:assert/strict";
import { buildIntegrationsUrl } from "./gmail-connect.url";

describe("buildIntegrationsUrl", () => {
	it("marks a completed connection", () => {
		assert.equal(buildIntegrationsUrl({ connected: true }), "/integrations?connected=1");
	});

	it("carries an error code back to the index", () => {
		assert.equal(
			buildIntegrationsUrl({ error: "oauth_state" }),
			"/integrations?error=oauth_state",
		);
	});
});
