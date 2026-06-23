import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	ALIVE_COOKIE_NAME,
	ALIVE_COOKIE_VALUE,
	DISMISS_COOKIE_NAME,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import request from "supertest";
import { ONBOARDING_VERSION } from "../../onboarding/onboarding.steps";
import { IOS_CLIENT_HEADER, IOS_CLIENT_VALUE } from "../../onboarding/ios-client";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { useTestServer, loginAgent, type TestAppHarness } from "../../../test-app";

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
	 * The two tests below pin both directions of the rule:
	 *   1. Both cookies present → onboarding stays hidden (the happy path).
	 *   2. Dismiss cookie alone → onboarding re-renders with install-extension
	 *      marked incomplete, so the user is prompted to install in this browser.
	 */
	it("renders onboarding hidden when dismiss cookie matches current version and extension is alive", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}; ${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must still be rendered so visibility is encoded as a state class");
		expect(onboarding.classList.contains("onboarding--hidden")).toBe(true);
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

/** Mobile Safari on iPhone, the platform that reads the per-user iOS signal. */
const IPHONE_UA =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function installTitle(html: string): string | null | undefined {
	return new JSDOM(html).window.document
		.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title')
		?.textContent;
}

function stepComplete(html: string, stepId: string): string | null | undefined {
	return new JSDOM(html).window.document
		.querySelector(`[data-test-onboarding-step="${stepId}"]`)
		?.getAttribute("data-test-onboarding-complete");
}

/** Mints a Bearer access token for the agent's logged-in user, so an app
 * request (Bearer, like the real iOS app) and Safari (the session cookie) act
 * as the same userId — the link the cross-app server-side signal depends on. */
async function bearerForLoggedInUser(harness: TestAppHarness): Promise<string> {
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist");
	const client = await harness.oauthModel.getClient("hutch-firefox-extension", "");
	assert(client, "oauth client must exist");
	const token = await harness.oauthModel.saveToken(
		{
			accessToken: "ios-onboarding-access-token",
			accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
			refreshToken: "ios-onboarding-refresh-token",
			refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3_600_000),
			client,
			user: { id: user.userId },
		},
		client,
		{ id: user.userId },
	);
	assert(token, "token must be saved");
	return token.accessToken;
}

describe("Queue onboarding — iPhone", () => {
	it("shows the iPhone-app steps incomplete by default for an iPhone visitor", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue").set("User-Agent", IPHONE_UA);

		const doc = new JSDOM(response.text).window.document;
		expect(installTitle(response.text)).toBe("Install the Readplace iPhone app");
		expect(
			doc
				.querySelector('[data-test-onboarding-step="install-extension"] [data-test-onboarding-action]')
				?.getAttribute("href"),
		).toBe("/install?client=iphone");
		expect(
			doc
				.querySelector('[data-test-onboarding-step="save-first-article-via-extension"] .onboarding__step-title')
				?.textContent,
		).toBe("Save your first article using the iPhone app");
		expect(stepComplete(response.text, "install-extension")).toBe("false");
		expect(stepComplete(response.text, "save-first-article-via-extension")).toBe("false");
	});

	it("completes the install step once the app records an authenticated queue load", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		// The app loads the queue carrying its client header → records activation.
		await agent.get("/queue").set("User-Agent", IPHONE_UA).set(IOS_CLIENT_HEADER, IOS_CLIENT_VALUE);

		// Safari on the same phone (same user, no header) now sees step 1 complete.
		const response = await agent.get("/queue").set("User-Agent", IPHONE_UA);

		expect(stepComplete(response.text, "install-extension")).toBe("true");
		expect(stepComplete(response.text, "save-first-article-via-extension")).toBe("false");
	});

	it("reaches the success state once the app records a save", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const token = await bearerForLoggedInUser(harness);

		// A share-sheet save (Bearer-authed, client header) records both signals at once.
		const save = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.set(IOS_CLIENT_HEADER, IOS_CLIENT_VALUE)
			.send({ url: "https://example.com/article" });
		expect(save.status).toBe(201);

		// Safari on the same phone (same user, session cookie) now sees success.
		const response = await agent.get("/queue").set("User-Agent", IPHONE_UA);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must be rendered");
		expect(onboarding.classList.contains("onboarding--complete")).toBe(true);
		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered once both iPhone steps are complete");
		expect(success.querySelector(".onboarding__success-title")?.textContent).toMatch(/You did it!/);
	});

	it("does not record an iOS signal for a Safari queue load that lacks the client header", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		// Safari visits twice with no client header — neither load may record activation.
		await agent.get("/queue").set("User-Agent", IPHONE_UA);
		const response = await agent.get("/queue").set("User-Agent", IPHONE_UA);

		expect(stepComplete(response.text, "install-extension")).toBe("false");
	});
});
