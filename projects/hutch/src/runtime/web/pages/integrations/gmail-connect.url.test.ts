import assert from "node:assert/strict";
import { buildIntegrationsUrl } from "./gmail-connect.url";

describe("buildIntegrationsUrl", () => {
	it("always carries the feature flag so the reader does not land on a 404", () => {
		assert.equal(buildIntegrationsUrl({}), "/integrations?feature=gmail");
	});

	it("marks a completed connection", () => {
		assert.equal(
			buildIntegrationsUrl({ connected: true }),
			"/integrations?feature=gmail&connected=1",
		);
	});

	it("carries an error code back to the index", () => {
		assert.equal(
			buildIntegrationsUrl({ error: "oauth_state" }),
			"/integrations?feature=gmail&error=oauth_state",
		);
	});
});
