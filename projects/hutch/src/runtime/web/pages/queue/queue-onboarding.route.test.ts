import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	ALIVE_COOKIE_NAME,
	ALIVE_COOKIE_VALUE,
	COOKIE_NAME,
	COOKIE_VALUE,
	DISMISS_COOKIE_NAME,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import { ONBOARDING_VERSION } from "../../onboarding/onboarding.steps";
import { useTestServer, loginAgent } from "../../../test-app";

import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

describe("Queue onboarding", () => {
	it("shows onboarding visible with both steps incomplete on empty queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

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
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

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
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${SAVE_COOKIE_NAME}=${SAVE_COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const step = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"]');
		assert(step, "save-first-article step must be rendered");
		expect(step.getAttribute("data-test-onboarding-complete")).toBe("true");
	});

	it("marks install-extension complete when alive cookie is present", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const step = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(step, "install-extension step must be rendered");
		expect(step.getAttribute("data-test-onboarding-complete")).toBe("true");
	});

	/** The legacy hutch_ext_installed cookie is writable from the extension's
	 * content script and persists for a year, so its presence does not prove
	 * the extension is currently installed. The server must ignore it for
	 * onboarding purposes — only the httpOnly hutch_ext_alive cookie counts. */
	it("does not mark install-extension complete when only the legacy hutch_ext_installed cookie is present", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${COOKIE_NAME}=${COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const step = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(step, "install-extension step must be rendered");
		expect(step.getAttribute("data-test-onboarding-complete")).toBe("false");
	});

	it("shows success message when both the alive and extension-save cookies are present", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}; ${SAVE_COOKIE_NAME}=${SAVE_COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must be rendered");
		expect(onboarding.classList.contains("onboarding--complete")).toBe(true);

		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered");
		expect(success.querySelector(".onboarding__success-title")?.textContent).toMatch(/You did it!/);
	});

	it("shows 'Install the Chrome browser extension' for Chrome user-agent", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36");

		const doc = new JSDOM(response.text).window.document;
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		expect(title.textContent).toBe("Install the Chrome browser extension");
	});

	it("shows 'Install the Firefox browser extension' for Firefox user-agent", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0");

		const doc = new JSDOM(response.text).window.document;
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		expect(title.textContent).toBe("Install the Firefox browser extension");
	});

	it("shows 'Install a browser extension' for unrecognised user-agent", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", "curl/8.0");

		const doc = new JSDOM(response.text).window.document;
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		expect(title.textContent).toBe("Install a browser extension");
	});

	it("shows success state even when viewing an empty filter tab", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent
			.get("/queue?status=read")
			.set("Cookie", `${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}; ${SAVE_COOKIE_NAME}=${SAVE_COOKIE_VALUE}`);

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
	 * install-extension step to be complete — meaning the alive cookie was set in
	 * this browser at the moment of dismissal. So the only way to reach
	 * "dismiss cookie present, alive cookie absent" is if the user has moved to
	 * a different context where the alive cookie doesn't apply:
	 *
	 *   - Same user, different browser. The user installed the extension in
	 *     Browser A and dismissed there. Cookies are browser-scoped, so Browser B
	 *     normally has neither cookie — but if the dismiss cookie is carried over
	 *     (profile import, manual cookie copy, sync tooling) without the alive
	 *     cookie, Browser B still needs the extension installed locally.
	 *   - Same browser, extension uninstalled after dismissing. The alive cookie
	 *     stops being renewed and lapses; the dismiss should not silently
	 *     suppress the prompt to reinstall once that happens.
	 *
	 * The three tests below pin all directions of the rule:
	 *   1. Both cookies present → onboarding stays hidden (the happy path).
	 *   2. Dismiss cookie alone → onboarding re-renders with install-extension
	 *      marked incomplete, so the user is prompted to install in this browser.
	 *   3. Dismiss + legacy hutch_ext_installed without alive → onboarding
	 *      re-renders, proving the legacy cookie does not satisfy dismissal.
	 */
	it("does not render onboarding when dismiss cookie matches current version and extension is alive", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}; ${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		expect(onboarding).toBeNull();
	});

	it("re-renders onboarding when dismiss cookie is present but alive cookie is missing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

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

	/** The exact bug this branch fixes: user installs the extension, completes
	 * onboarding, dismisses it, then uninstalls the extension. The legacy
	 * hutch_ext_installed cookie persists in the browser jar (1-year TTL,
	 * written by the content script) but the httpOnly hutch_ext_alive lapses
	 * once Siren requests stop. Onboarding must come back. */
	it("re-renders onboarding after uninstall (dismiss + legacy cookie present, alive cookie missing)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}; ${COOKIE_NAME}=${COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding must re-render once the extension stops renewing the alive cookie");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);
		const installStep = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(installStep);
		expect(installStep.getAttribute("data-test-onboarding-complete")).toBe("false");
	});

	it("re-renders onboarding when dismiss cookie has a stale version", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${DISMISS_COOKIE_NAME}=stale-version; ${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must re-render when cookie version is stale");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);
	});

	it("POST /queue/dismiss-onboarding sets dismiss cookie to current version and redirects to /queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent.post("/queue/dismiss-onboarding");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
		const cookies = response.headers["set-cookie"];
		assert(cookies, "set-cookie header must be present");
		const cookieStr = Array.isArray(cookies) ? cookies.join("; ") : cookies;
		expect(cookieStr).toContain(`${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}`);
	});
});
