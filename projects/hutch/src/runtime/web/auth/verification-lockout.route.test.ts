import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();
const DAY_MS = 24 * 60 * 60 * 1000;

/** A fixture whose server clock runs `days` ahead of real time, so a user
 * created now lands past the 7-day verification window without any way to
 * backdate `registeredAt` directly. */
function fixtureClockedDaysAhead(days: number) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	fixture.shared.now = () => new Date(Date.now() + days * DAY_MS);
	return fixture;
}

describe("Email verification lockout", () => {
	it("shows the days-only countdown on the queue while still inside the window", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.getAttribute("data-verification-state")).toBe("counting-down");
		expect(banner.textContent).toContain("7 days");
		expect(banner.textContent).toContain("before your account is locked");
	});

	it("locks the queue with a contact-support screen once the window lapses", async () => {
		const harness = useApp(fixtureClockedDaysAhead(8));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue");

		expect(response.status).toBe(403);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("h1")?.textContent).toBe("Your account is locked");

		const contact = doc.querySelector(".auth-card__link");
		assert(contact, "locked screen must offer a contact link");
		expect(contact.getAttribute("href")).toBe(
			"mailto:readplace+verification@readplace.com",
		);

		const logout = doc.querySelector('form[action="/logout"]');
		assert(logout, "locked screen must keep a logout escape hatch");
		expect(logout.getAttribute("method")?.toUpperCase()).toBe("POST");

		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.getAttribute("data-verification-state")).toBe("locked");
	});

	it("locks export, import, and account for a lapsed account", async () => {
		const harness = useApp(fixtureClockedDaysAhead(8));
		const agent = await loginAgent(harness.server, harness.auth);

		for (const path of ["/export", "/import", "/account"]) {
			const response = await agent.get(path);
			expect(response.status).toBe(403);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Your account is locked");
		}
	});

	it("still lets a locked account sign out", async () => {
		const harness = useApp(fixtureClockedDaysAhead(8));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/logout");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/");
	});

	it("never locks a verified account, even long past the window", async () => {
		const harness = useApp(fixtureClockedDaysAhead(8));
		await harness.auth.createUser({ email: "verified@example.com", password: "password123" });
		await harness.auth.markEmailVerified("verified@example.com");

		const agent = request.agent(harness.server);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "verified@example.com", password: "password123" });

		const response = await agent.get("/queue");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.getAttribute("data-verification-state")).toBe("verified");
		expect(banner.classList.contains("verify-banner--hidden")).toBe(true);
	});
});
