import assert from "node:assert/strict";
import { buildIntegrationsUrl } from "./gmail-connect.url";

describe("buildIntegrationsUrl", () => {
	it("carries an error code back to the index", () => {
		assert.equal(
			buildIntegrationsUrl({ error: "oauth_state" }),
			"/integrations?error=oauth_state",
		);
	});

	it("carries a notice code back to the index", () => {
		assert.equal(
			buildIntegrationsUrl({ notice: "gmail_disconnected" }),
			"/integrations?notice=gmail_disconnected",
		);
	});
});
