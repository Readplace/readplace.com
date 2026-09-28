import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../test-app";

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;

describe("requireNotLocked", () => {
	it("renders the account-locked screen in the reader's chosen appearance", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => new Date(Date.now() + 8 * ONE_DAY_MS);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		await harness.auth.setUserAppearance({ userId, appearance: "dark" });

		const response = await agent.post("/inbox/create").set("Accept", "text/html");

		expect(response.status).toBe(403);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("h1")?.textContent).toBe("Your account is locked");
		expect(doc.body.classList.contains("theme-dark")).toBe(true);
	});
});
