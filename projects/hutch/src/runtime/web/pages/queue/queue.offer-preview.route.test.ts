import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

describe("Founding-offer preview gate", () => {
	it("omits the popup, its script, and its styles on an ordinary /queue visit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent.get("/queue");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		assert.equal(doc.querySelector("[data-test-offer-popup]"), null);
		assert.equal(response.text.includes("offer-popup.client.js"), false);
		assert.equal(response.text.includes(".offer-popup__panel"), false);
	});

	it("renders the popup, its script, and its styles only under ?offer-preview=1", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent.get("/queue?offer-preview=1");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		assert(
			doc.querySelector("[data-test-offer-popup]"),
			"popup markup must render under the preview flag",
		);
		assert(
			response.text.includes("offer-popup.client.js"),
			"client script must ship under the preview flag",
		);
		assert(
			response.text.includes(".offer-popup__panel"),
			"popup styles must ship under the preview flag",
		);
	});
});
