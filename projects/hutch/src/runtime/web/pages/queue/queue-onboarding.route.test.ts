import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import {
	COOKIE_NAME,
	COOKIE_VALUE,
	DISMISS_COOKIE_NAME,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import { ONBOARDING_VERSION } from "../../onboarding/onboarding.steps";
import { createTestApp, type TestAppResult } from "../../../test-app";

import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "../../../test-app-fakes";

async function loginAgent(app: TestAppResult['app'], auth: TestAppResult['auth']) {
	await auth.createUser({ email: "test@example.com", password: "password123" });
	const agent = request.agent(app);
	await agent
		.post("/login")
		.type("form")
		.send({ email: "test@example.com", password: "password123" });
	return agent;
}

describe("Queue onboarding", () => {
	it("shows onboarding visible with both steps incomplete on empty queue", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent.get("/queue");

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must be rendered");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);

		const installStep = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(installStep, "install-extension step must be rendered");
		expect(installStep.getAttribute("data-test-onboarding-complete")).toBe("false");

		const saveFirstStep = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"]');
		assert(saveFirstStep, "save-first-article step must be rendered");
		expect(saveFirstStep.getAttribute("data-test-onboarding-complete")).toBe("false");
	});

	it("does not complete save-first-article when the article was saved via the web form", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/article" });

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must be rendered");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);

		const saveStep = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"]');
		assert(saveStep);
		expect(saveStep.getAttribute("data-test-onboarding-complete")).toBe("false");
	});

	it("marks save-first-article complete when extension save cookie is present", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${SAVE_COOKIE_NAME}=${SAVE_COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const step = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"]');
		assert(step, "save-first-article step must be rendered");
		expect(step.getAttribute("data-test-onboarding-complete")).toBe("true");
	});

	it("marks install-extension complete when extension cookie is present", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${COOKIE_NAME}=${COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const step = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(step, "install-extension step must be rendered");
		expect(step.getAttribute("data-test-onboarding-complete")).toBe("true");
	});

	it("shows success message when both the install and extension-save cookies are present", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${COOKIE_NAME}=${COOKIE_VALUE}; ${SAVE_COOKIE_NAME}=${SAVE_COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must be rendered");
		expect(onboarding.classList.contains("onboarding--complete")).toBe(true);

		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered");
		expect(success.querySelector(".onboarding__success-title")?.textContent).toMatch(/You did it!/);
	});

	// TODO: Re-enable once Chrome extension v1.0.108+ is published and the bypass
	// in onboarding.steps.ts is removed. While the bypass is active, allComplete
	// is true for Chrome users so the steps list is not rendered (success state shows instead).
	// https://chromewebstore.google.com/detail/hutch-%E2%80%94-save-articles-rea/klblengmhlfnmjoagchagfcdbpbocgbf
	it.skip("shows 'Install the Chrome browser extension' for Chrome user-agent", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36");

		const doc = new JSDOM(response.text).window.document;
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		expect(title.textContent).toBe("Install the Chrome browser extension");
	});

	it("shows 'Install the Firefox browser extension' for Firefox user-agent", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0");

		const doc = new JSDOM(response.text).window.document;
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		expect(title.textContent).toBe("Install the Firefox browser extension");
	});

	it("shows 'Install a browser extension' for unrecognised user-agent", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", "curl/8.0");

		const doc = new JSDOM(response.text).window.document;
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		expect(title.textContent).toBe("Install a browser extension");
	});

	it("shows success state even when viewing an empty filter tab", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue?status=read")
			.set("Cookie", `${COOKIE_NAME}=${COOKIE_VALUE}; ${SAVE_COOKIE_NAME}=${SAVE_COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must still be rendered");
		expect(onboarding.classList.contains("onboarding--complete")).toBe(true);

		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered");
	});

	/** Dismissal hides the onboarding only when *both* cookies are present together.
	 *
	 * The dismiss button only appears in the success state, which requires the
	 * install-extension step to be complete — meaning the install cookie was set in
	 * this browser at the moment of dismissal. So the only way to reach
	 * "dismiss cookie present, install cookie absent" is if the user has moved to
	 * a different context where the install cookie doesn't apply:
	 *
	 *   - Same user, different browser. The user installed the extension in
	 *     Browser A and dismissed there. Cookies are browser-scoped, so Browser B
	 *     normally has neither cookie — but if the dismiss cookie is carried over
	 *     (profile import, manual cookie copy, sync tooling) without the install
	 *     cookie, Browser B still needs the extension installed locally.
	 *   - Same browser, install cookie lost. The user uninstalled the extension
	 *     after dismissing, or cleared the install cookie selectively. The dismiss
	 *     should not silently suppress the prompt to reinstall.
	 *
	 * The two tests below pin both directions of the rule:
	 *   1. Both cookies present → onboarding stays hidden (the happy path).
	 *   2. Dismiss cookie alone → onboarding re-renders with install-extension
	 *      marked incomplete, so the user is prompted to install in this browser.
	 */
	it("does not render onboarding when dismiss cookie matches current version and extension is installed", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}; ${COOKIE_NAME}=${COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		expect(onboarding).toBeNull();
	});

	it("re-renders onboarding when dismiss cookie is present but extension cookie is missing", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding must re-render so the user can install the extension in this browser");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);
		const installStep = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(installStep);
		expect(installStep.getAttribute("data-test-onboarding-complete")).toBe("false");
	});

	it("re-renders onboarding when dismiss cookie has a stale version", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${DISMISS_COOKIE_NAME}=stale-version; ${COOKIE_NAME}=${COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must re-render when cookie version is stale");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);
	});

	it("POST /queue/dismiss-onboarding sets dismiss cookie to current version and redirects to /queue", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent.post("/queue/dismiss-onboarding");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
		const cookies = response.headers["set-cookie"];
		assert(cookies, "set-cookie header must be present");
		const cookieStr = Array.isArray(cookies) ? cookies.join("; ") : cookies;
		expect(cookieStr).toContain(`${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}`);
	});

	/** TODO: Remove this Chrome-bypass block once Chrome extension v1.0.108+ is
	 * published and the bypass in onboarding.steps.ts is removed.
	 * https://chromewebstore.google.com/detail/hutch-%E2%80%94-save-articles-rea/klblengmhlfnmjoagchagfcdbpbocgbf
	 */
	describe("Chrome bypass", () => {
		const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
		const CHROME_DISMISS_VALUE = `${ONBOARDING_VERSION}-chrome-bypass`;

		it("Chrome user-agent gets the success state with install button on an empty queue", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);

			const response = await agent.get("/queue").set("User-Agent", CHROME_UA);

			const doc = new JSDOM(response.text).window.document;
			const onboarding = doc.querySelector("[data-test-onboarding]");
			assert(onboarding, "onboarding container must be rendered");
			expect(onboarding.classList.contains("onboarding--complete")).toBe(true);

			const action = doc.querySelector("[data-test-onboarding-success-action]");
			assert(action, "Chrome install button must be surfaced inside the success state");
			expect(action.getAttribute("href")).toBe("/install?browser=chrome");
		});

		it("POST /queue/dismiss-onboarding sets the suffixed dismiss cookie for Chrome user-agent", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);

			const response = await agent
				.post("/queue/dismiss-onboarding")
				.set("User-Agent", CHROME_UA);

			const cookies = response.headers["set-cookie"];
			assert(cookies, "set-cookie header must be present");
			const cookieStr = Array.isArray(cookies) ? cookies.join("; ") : cookies;
			expect(cookieStr).toContain(`${DISMISS_COOKIE_NAME}=${CHROME_DISMISS_VALUE}`);
		});

		it("Chrome dismiss cookie hides onboarding when extension is installed", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);

			const response = await agent
				.get("/queue")
				.set("User-Agent", CHROME_UA)
				.set("Cookie", `${DISMISS_COOKIE_NAME}=${CHROME_DISMISS_VALUE}; ${COOKIE_NAME}=${COOKIE_VALUE}`);

			const doc = new JSDOM(response.text).window.document;
			const onboarding = doc.querySelector("[data-test-onboarding]");
			expect(onboarding).toBeNull();
		});

		it("unsuffixed dismiss cookie does not hide onboarding for Chrome user-agent (re-prompt after bypass removal)", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);

			const response = await agent
				.get("/queue")
				.set("User-Agent", CHROME_UA)
				.set("Cookie", `${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}; ${COOKIE_NAME}=${COOKIE_VALUE}`);

			const doc = new JSDOM(response.text).window.document;
			const onboarding = doc.querySelector("[data-test-onboarding]");
			assert(onboarding, "onboarding must re-render — the unsuffixed value isn't a valid Chrome dismissal during the bypass");
		});
	});
});
