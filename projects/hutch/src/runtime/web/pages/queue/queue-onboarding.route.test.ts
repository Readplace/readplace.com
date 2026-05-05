import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import type { Token, Client } from "@node-oauth/oauth2-server";
import { COOKIE_NAME, COOKIE_VALUE, DISMISS_COOKIE_NAME } from "@packages/onboarding-extension-signal";
import { ONBOARDING_VERSION } from "../../onboarding/onboarding.steps";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import type { UserId } from "../../../domain/user/user.types";
import { createTestApp, type TestAppResult } from "../../../test-app";

import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "../../../test-app-fakes";

interface AgentBundle {
	agent: ReturnType<typeof request.agent>;
	userId: UserId;
	accessToken: string;
}

async function bootstrap(testApp: TestAppResult): Promise<AgentBundle> {
	const created = await testApp.auth.createUser({ email: "test@example.com", password: "password123" });
	assert(created.ok, "user creation must succeed");
	const userId = created.userId;

	const agent = request.agent(testApp.app);
	await agent
		.post("/login")
		.type("form")
		.send({ email: "test@example.com", password: "password123" });

	const client = await testApp.oauthModel.getClient("hutch-firefox-extension", "");
	assert(client, "Test client must exist");
	const oauthToken: Token = {
		accessToken: "test-access-token",
		accessTokenExpiresAt: new Date(Date.now() + 3600000),
		refreshToken: "test-refresh-token",
		refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
		client: {
			id: "hutch-firefox-extension",
			grants: ["authorization_code", "refresh_token"],
			redirectUris: ["http://127.0.0.1:3000/oauth/callback"],
		} as Client,
		user: { id: userId },
	};
	const saved = await testApp.oauthModel.saveToken(oauthToken, client, { id: userId });
	assert(saved, "Token should be saved");

	return { agent, userId, accessToken: saved.accessToken };
}

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

describe("Queue onboarding", () => {
	it("shows onboarding visible with both steps incomplete on empty queue", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await bootstrap(testApp);

		const response = await agent.get("/queue");

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must be rendered");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);

		const installStep = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(installStep, "install-extension step must be rendered");
		expect(installStep.getAttribute("data-test-onboarding-complete")).toBe("false");

		const saveStep = doc.querySelector('[data-test-onboarding-step="save-via-extension"]');
		assert(saveStep, "save-via-extension step must be rendered");
		expect(saveStep.getAttribute("data-test-onboarding-complete")).toBe("false");
	});

	it("does not mark save-via-extension when saving via the web form", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await bootstrap(testApp);

		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/article" });

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must be rendered");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);

		const saveStep = doc.querySelector('[data-test-onboarding-step="save-via-extension"]');
		assert(saveStep, "save-via-extension step must remain rendered");
		expect(saveStep.getAttribute("data-test-onboarding-complete")).toBe("false");
	});

	it("marks save-via-extension when saving via the Siren POST /queue", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, accessToken } = await bootstrap(testApp);

		await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ url: "https://example.com/article-siren" });

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const saveStep = doc.querySelector('[data-test-onboarding-step="save-via-extension"]');
		assert(saveStep, "save-via-extension step must be rendered");
		expect(saveStep.getAttribute("data-test-onboarding-complete")).toBe("true");
	});

	it("marks save-via-extension when saving via POST /queue/save-html", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, accessToken } = await bootstrap(testApp);

		await request(testApp.app)
			.post("/queue/save-html")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				url: "https://example.com/article-html",
				rawHtml: "<html><body><p>captured</p></body></html>",
				title: "Captured",
			});

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const saveStep = doc.querySelector('[data-test-onboarding-step="save-via-extension"]');
		assert(saveStep, "save-via-extension step must be rendered");
		expect(saveStep.getAttribute("data-test-onboarding-complete")).toBe("true");
	});

	it("marks save-via-extension on the rawHtml-too-big URL-only fallback path", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, accessToken } = await bootstrap(testApp);

		const oversizedHtml = "x".repeat(2_000_001);
		await request(testApp.app)
			.post("/queue/save-html")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				url: "https://example.com/article-fallback",
				rawHtml: oversizedHtml,
			});

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const saveStep = doc.querySelector('[data-test-onboarding-step="save-via-extension"]');
		assert(saveStep, "save-via-extension step must be rendered");
		expect(saveStep.getAttribute("data-test-onboarding-complete")).toBe("true");
	});

	it("marks install-extension complete when extension cookie is present and persists into the table", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await bootstrap(testApp);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${COOKIE_NAME}=${COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const step = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(step, "install-extension step must be rendered");
		expect(step.getAttribute("data-test-onboarding-complete")).toBe("true");

		// Persistence: the table is now the source of truth, so the next render
		// would see install-extension as complete even if the UA lost the cookie.
		expect(testApp.onboarding.debugStateFor(userId).has("install-extension")).toBe(true);
	});

	it("shows success state when install-extension cookie is present and a Siren save has been recorded", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, accessToken } = await bootstrap(testApp);

		await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ url: "https://example.com/article-success" });

		const response = await agent
			.get("/queue")
			.set("Cookie", `${COOKIE_NAME}=${COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must be rendered");
		expect(onboarding.classList.contains("onboarding--complete")).toBe(true);

		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered");
		expect(success.querySelector(".onboarding__success-title")?.textContent).toMatch(/You did it!/);
	});

	it("shows 'Install the Chrome browser extension' for Chrome user-agent", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await bootstrap(testApp);

		const response = await agent
			.get("/queue")
			.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36");

		const doc = new JSDOM(response.text).window.document;
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		expect(title.textContent).toBe("Install the Chrome browser extension");
	});

	it("shows 'Install the Firefox browser extension' for Firefox user-agent", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await bootstrap(testApp);

		const response = await agent
			.get("/queue")
			.set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0");

		const doc = new JSDOM(response.text).window.document;
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		expect(title.textContent).toBe("Install the Firefox browser extension");
	});

	it("shows 'Install a browser extension' for unrecognised user-agent", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await bootstrap(testApp);

		const response = await agent
			.get("/queue")
			.set("User-Agent", "curl/8.0");

		const doc = new JSDOM(response.text).window.document;
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		expect(title.textContent).toBe("Install a browser extension");
	});

	it("shows success state even when viewing an empty filter tab", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, accessToken } = await bootstrap(testApp);

		await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ url: "https://example.com/article-empty-tab" });

		const response = await agent
			.get("/queue?status=read")
			.set("Cookie", `${COOKIE_NAME}=${COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must still be rendered");
		expect(onboarding.classList.contains("onboarding--complete")).toBe(true);

		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered");
	});

	it("does not render onboarding when dismiss cookie matches current version", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await bootstrap(testApp);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		expect(onboarding).toBeNull();
	});

	it("re-renders onboarding when dismiss cookie has a stale version", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await bootstrap(testApp);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${DISMISS_COOKIE_NAME}=stale-version`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must re-render when cookie version is stale");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);
	});

	it("hides install-extension step for iPhone user-agent", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await bootstrap(testApp);

		const response = await agent
			.get("/queue")
			.set("User-Agent", IPHONE_UA);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must still be rendered");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);

		const installStep = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		expect(installStep).toBeNull();

		const saveStep = doc.querySelector('[data-test-onboarding-step="save-via-extension"]');
		assert(saveStep, "save step must remain on mobile");
	});

	it("hides install-extension step for Android Chrome user-agent", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await bootstrap(testApp);

		const response = await agent
			.get("/queue")
			.set("User-Agent", "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36");

		const doc = new JSDOM(response.text).window.document;
		const installStep = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		expect(installStep).toBeNull();
	});

	it("reaches the success state on mobile when an extension save has been recorded", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, accessToken } = await bootstrap(testApp);

		await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ url: "https://example.com/mobile-extension-save" });

		const response = await agent
			.get("/queue")
			.set("User-Agent", IPHONE_UA);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must be rendered");
		expect(onboarding.classList.contains("onboarding--complete")).toBe(true);

		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered");
	});

	it("renders the page when best-effort derivable persistence throws", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const throwing: typeof fixture.onboarding = {
			onboarding: {
				...fixture.onboarding.onboarding,
				markOnboardingStepCompleted: async () => { throw new Error("DynamoDB transient failure"); },
				debugStateFor: fixture.onboarding.onboarding.debugStateFor,
			},
		};
		const testApp = createTestApp({ ...fixture, onboarding: throwing });
		const { agent } = await bootstrap(testApp);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${COOKIE_NAME}=${COOKIE_VALUE}`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const step = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(step, "install-extension step must still render despite persistence failure");
		expect(step.getAttribute("data-test-onboarding-complete")).toBe("true");
	});

	it("POST /queue still returns 201 when markOnboardingStepCompleted throws", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const throwing: typeof fixture.onboarding = {
			onboarding: {
				...fixture.onboarding.onboarding,
				markOnboardingStepCompleted: async () => { throw new Error("DynamoDB transient failure"); },
				debugStateFor: fixture.onboarding.onboarding.debugStateFor,
			},
		};
		const testApp = createTestApp({ ...fixture, onboarding: throwing });
		const { accessToken } = await bootstrap(testApp);

		const response = await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ url: "https://example.com/siren-save-resilient" });

		expect(response.status).toBe(201);
	});

	it("POST /queue/save-html still returns 201 when markOnboardingStepCompleted throws", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const throwing: typeof fixture.onboarding = {
			onboarding: {
				...fixture.onboarding.onboarding,
				markOnboardingStepCompleted: async () => { throw new Error("DynamoDB transient failure"); },
				debugStateFor: fixture.onboarding.onboarding.debugStateFor,
			},
		};
		const testApp = createTestApp({ ...fixture, onboarding: throwing });
		const { accessToken } = await bootstrap(testApp);

		const response = await request(testApp.app)
			.post("/queue/save-html")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				url: "https://example.com/html-save-resilient",
				rawHtml: "<html><body><p>test</p></body></html>",
				title: "Test",
			});

		expect(response.status).toBe(201);
	});

	it("POST /queue/save-html rawHtml-too-big fallback still returns 201 when markOnboardingStepCompleted throws", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const throwing: typeof fixture.onboarding = {
			onboarding: {
				...fixture.onboarding.onboarding,
				markOnboardingStepCompleted: async () => { throw new Error("DynamoDB transient failure"); },
				debugStateFor: fixture.onboarding.onboarding.debugStateFor,
			},
		};
		const testApp = createTestApp({ ...fixture, onboarding: throwing });
		const { accessToken } = await bootstrap(testApp);

		const oversizedHtml = "x".repeat(2_000_001);
		const response = await request(testApp.app)
			.post("/queue/save-html")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				url: "https://example.com/fallback-save-resilient",
				rawHtml: oversizedHtml,
			});

		expect(response.status).toBe(201);
	});

	it("POST /queue/dismiss-onboarding sets dismiss cookie to current version and redirects to /queue", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await bootstrap(testApp);

		const response = await agent.post("/queue/dismiss-onboarding");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
		const cookies = response.headers["set-cookie"];
		assert(cookies, "set-cookie header must be present");
		const cookieStr = Array.isArray(cookies) ? cookies.join("; ") : cookies;
		expect(cookieStr).toContain(`${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}`);
	});
});

