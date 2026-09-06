import assert from "node:assert/strict";
import { NEXT_READ_MINIMUM_SAVES } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { CountArticlesQuery } from "@packages/provider-contracts/article-store";
import type { OnboardingSignalsBundle } from "@packages/web-test-harness";
import { JSDOM } from "jsdom";
import {
	ALIVE_COOKIE_NAME,
	ALIVE_COOKIE_VALUE,
	DISMISS_COOKIE_NAME,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import request from "supertest";
import { NO_CLIENT_ONBOARDING_VERSION, ONBOARDING_VERSION } from "../../onboarding/onboarding.steps";
import { NATIVE_CLIENT_HEADER } from "../../onboarding/native-client";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { useTestServer, loginAgent, type TestAppHarness } from "../../../test-app";

import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

/** Seeds an account already past the Next Read minimum without paying for the
 * saves: the milestone only ever reads a bounded count, so a stubbed count is
 * indistinguishable from a real pile and keeps these cases off 50 round-trips. */
function fixtureWithSavedCount(savedCount: number) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	return {
		...fixture,
		articleStore: {
			...fixture.articleStore,
			countArticlesByUser: async (query: CountArticlesQuery) =>
				Math.min(savedCount, query.countLimit ?? savedCount),
		},
	};
}

/** An account that starts below the Next Read minimum and crosses it on demand,
 * so a test can render the step outstanding — the sighting the success card is
 * owed to — before the pile is deep enough to tick it. */
function fixtureCrossingMilestone(): {
	fixture: ReturnType<typeof createDefaultTestAppFixture>;
	reachMilestone: () => void;
} {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	let savedCount = 0;
	return {
		reachMilestone: () => {
			savedCount = NEXT_READ_MINIMUM_SAVES;
		},
		fixture: {
			...fixture,
			articleStore: {
				...fixture.articleStore,
				countArticlesByUser: async (query: CountArticlesQuery) =>
					Math.min(savedCount, query.countLimit ?? savedCount),
			},
		},
	};
}

async function loggedInUserId(harness: TestAppHarness): Promise<UserId> {
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist");
	return user.userId;
}

async function tickEmailStep(
	fixture: { onboardingSignals: OnboardingSignalsBundle },
	harness: TestAppHarness,
): Promise<void> {
	await fixture.onboardingSignals.recordInboxArticleQueued({
		userId: await loggedInUserId(harness),
	});
}

async function markSeenOutstanding(
	fixture: { onboardingSignals: OnboardingSignalsBundle },
	harness: TestAppHarness,
): Promise<void> {
	await fixture.onboardingSignals.recordOnboardingOutstandingVersion({
		userId: await loggedInUserId(harness),
		version: ONBOARDING_VERSION,
	});
}

/** Desktop Chrome — a platform with an installable client, so these requests
 * exercise the completion-gated step checklist. Superagent sends no
 * User-Agent by default, which resolves to the no-client "other" bucket, so
 * the client-flow tests must set one explicitly. */
const CHROME_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

describe("Readlist onboarding", () => {
	it("shows onboarding visible with both steps incomplete on empty readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent.get("/queue").set("User-Agent", CHROME_UA);

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

		const response = await agent.get("/queue").set("User-Agent", CHROME_UA);
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
			.set("User-Agent", CHROME_UA)
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
			.set("User-Agent", CHROME_UA)
			.set("Cookie", `${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const step = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(step, "install-extension step must be rendered");
		expect(step.getAttribute("data-test-onboarding-complete")).toBe("true");
	});

	it("shows success message when the alive and extension-save cookies are present and the pile is deep enough", async () => {
		const crossing = fixtureCrossingMilestone();
		const harness = useApp(crossing.fixture);
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);
		const cookies = `${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}; ${SAVE_COOKIE_NAME}=${SAVE_COOKIE_VALUE}`;
		await agent.get("/queue").set("User-Agent", CHROME_UA).set("Cookie", cookies);
		crossing.reachMilestone();
		await tickEmailStep(crossing.fixture, harness);

		const response = await agent
			.get("/queue")
			.set("User-Agent", CHROME_UA)
			.set("Cookie", cookies);

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

	it("shows success state even when viewing an empty filter tab", async () => {
		const crossing = fixtureCrossingMilestone();
		const harness = useApp(crossing.fixture);
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);
		const cookies = `${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}; ${SAVE_COOKIE_NAME}=${SAVE_COOKIE_VALUE}`;
		await agent.get("/queue").set("User-Agent", CHROME_UA).set("Cookie", cookies);
		crossing.reachMilestone();
		await tickEmailStep(crossing.fixture, harness);

		const response = await agent
			.get("/queue?status=read")
			.set("User-Agent", CHROME_UA)
			.set("Cookie", cookies);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must still be rendered");
		expect(onboarding.classList.contains("onboarding--complete")).toBe(true);

		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered");
	});

	it("renders onboarding hidden when dismiss cookie matches current version and extension is alive", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", CHROME_UA)
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
			.set("User-Agent", CHROME_UA)
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
			.set("User-Agent", CHROME_UA)
			.set("Cookie", `${DISMISS_COOKIE_NAME}=stale-version; ${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must re-render when cookie version is stale");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);
	});

	it("POST /queue/dismiss-onboarding from a client device sets the step-hash version and redirects to /queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent.post("/queue/dismiss-onboarding?utm_source=onboarding&utm_medium=internal&utm_content=dismiss-no-client").set("User-Agent", CHROME_UA);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
		const cookies = response.headers["set-cookie"];
		assert(cookies, "set-cookie header must be present");
		const cookieStr = Array.isArray(cookies) ? cookies.join("; ") : cookies;
		expect(cookieStr).toContain(`${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}`);
	});

	describe("success-card welcome copy", () => {
		function successMessage(html: string): Element {
			const message = new JSDOM(html).window.document.querySelector(
				".onboarding__success-message",
			);
			assert(message, "success message element must be rendered");
			return message;
		}

		const ALL_COMPLETE_COOKIES = `${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}; ${SAVE_COOKIE_NAME}=${SAVE_COOKIE_VALUE}`;

		it("welcomes a first-time completion with the full message", async () => {
			const fixture = fixtureWithSavedCount(NEXT_READ_MINIMUM_SAVES);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await tickEmailStep(fixture, harness);
			await markSeenOutstanding(fixture, harness);

			const response = await agent
				.get("/queue")
				.set("User-Agent", CHROME_UA)
				.set("Cookie", ALL_COMPLETE_COOKIES);

			const message = successMessage(response.text);
			expect(message.classList.contains("onboarding__success-message--hidden")).toBe(false);
			expect(message.textContent).toContain("one of us");
		});

		it("greets a re-onboarded user with just the title once a past dismissal shows they finished before", async () => {
			const fixture = fixtureWithSavedCount(NEXT_READ_MINIMUM_SAVES);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await tickEmailStep(fixture, harness);
			await markSeenOutstanding(fixture, harness);

			const response = await agent
				.get("/queue")
				.set("User-Agent", CHROME_UA)
				.set(
					"Cookie",
					`${DISMISS_COOKIE_NAME}=stale-version; ${ALL_COMPLETE_COOKIES}`,
				);

			const message = successMessage(response.text);
			expect(message.classList.contains("onboarding__success-message--hidden")).toBe(true);
		});

		it("still welcomes in full when the only past dismissal was the no-client escape card", async () => {
			const fixture = fixtureWithSavedCount(NEXT_READ_MINIMUM_SAVES);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await tickEmailStep(fixture, harness);
			await markSeenOutstanding(fixture, harness);

			const response = await agent
				.get("/queue")
				.set("User-Agent", CHROME_UA)
				.set(
					"Cookie",
					`${DISMISS_COOKIE_NAME}=${NO_CLIENT_ONBOARDING_VERSION}; ${ALL_COMPLETE_COOKIES}`,
				);

			const message = successMessage(response.text);
			expect(message.classList.contains("onboarding__success-message--hidden")).toBe(false);
		});
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

/** Bearer (app) and the session cookie (Safari) must resolve to the same
 * userId — the link the cross-app server-side signal depends on. */
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

describe("Readlist onboarding — iPhone", () => {
	it("shows the iPhone-app steps incomplete by default for an iPhone visitor", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue").set("User-Agent", IPHONE_UA);

		const doc = new JSDOM(response.text).window.document;
		expect(installTitle(response.text)).toBe("Install the Readplace iPhone app");
		const installForm = doc
			.querySelector('[data-test-onboarding-step="install-extension"] [data-test-onboarding-action="install"]')
			?.closest("form");
		assert(installForm, "install action must render as a form");
		expect(installForm.getAttribute("action")).toBe("/install");
		expect(installForm.querySelector('input[name="client"]')?.getAttribute("value")).toBe("iphone");
		expect(
			doc
				.querySelector('[data-test-onboarding-step="save-first-article-via-extension"] .onboarding__step-title')
				?.textContent,
		).toBe("Save your first article using the iPhone app");
		expect(stepComplete(response.text, "install-extension")).toBe("false");
		expect(stepComplete(response.text, "save-first-article-via-extension")).toBe("false");
	});

	it("completes the install step once the app records an authenticated readlist load", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		// The app loads the readlist carrying its client header → records activation.
		await agent.get("/queue").set("User-Agent", IPHONE_UA).set(NATIVE_CLIENT_HEADER, "ios");

		// Safari on the same phone (same user, no header) now sees step 1 complete.
		const response = await agent.get("/queue").set("User-Agent", IPHONE_UA);

		expect(stepComplete(response.text, "install-extension")).toBe("true");
		expect(stepComplete(response.text, "save-first-article-via-extension")).toBe("false");
	});

	it("reaches the success state once the app records a save", async () => {
		const crossing = fixtureCrossingMilestone();
		const harness = useApp(crossing.fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.get("/queue").set("User-Agent", IPHONE_UA);
		crossing.reachMilestone();
		await tickEmailStep(crossing.fixture, harness);
		const token = await bearerForLoggedInUser(harness);

		// A share-sheet save (Bearer-authed, client header) records both signals at once.
		const save = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.set(NATIVE_CLIENT_HEADER, "ios")
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

	it("does not record an iOS signal for a Safari readlist load that lacks the client header", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		// Safari visits twice with no client header — neither load may record activation.
		await agent.get("/queue").set("User-Agent", IPHONE_UA);
		const response = await agent.get("/queue").set("User-Agent", IPHONE_UA);

		expect(stepComplete(response.text, "install-extension")).toBe("false");
	});

	/** The iOS onboarding signal is non-essential bookkeeping; recording it must
	 * never convert a successful save into a 500 or fail the app's readlist load. The
	 * write hits DynamoDB and can throw (transient error, or the missing-user-row
	 * assert for a token that outlived a deleted account), so it is best-effort. */
	it("returns 201 for a save even when recording the iOS save signal throws", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const loggedErrors: Error[] = [];
		const harness = useApp({
			...fixture,
			onboardingSignals: {
				...fixture.onboardingSignals,
				recordNativeAppSavedArticle: async () => { throw new Error("dynamo down"); },
			},
			shared: {
				...fixture.shared,
				logError: (_msg, err) => { if (err) loggedErrors.push(err); },
			},
		});
		await loginAgent(harness.server, harness.auth);
		const token = await bearerForLoggedInUser(harness);

		const save = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.set(NATIVE_CLIENT_HEADER, "ios")
			.send({ url: "https://example.com/article" });

		expect(save.status).toBe(201);
		expect(loggedErrors).toHaveLength(1);
	});

	it("returns 200 for the readlist load even when recording the iOS activation signal throws a non-Error", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errorArgs: unknown[] = [];
		const harness = useApp({
			...fixture,
			onboardingSignals: {
				...fixture.onboardingSignals,
				// biome-ignore lint/suspicious/noExplicitAny: deliberately throws a non-Error to exercise the `instanceof Error ? … : undefined` branch
				recordNativeAppAnyActivity: async () => { throw "dynamo down" as any; },
			},
			shared: {
				...fixture.shared,
				logError: (msg, err) => { errorArgs.push([msg, err]); },
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", IPHONE_UA)
			.set(NATIVE_CLIENT_HEADER, "ios");

		expect(response.status).toBe(200);
		expect(errorArgs).toEqual([["Failed to record onboarding signal", undefined]]);
	});
});

/** Desktop Safari reports as Macintosh, so it falls into the "other" bucket
 * that has no installable client. */
const DESKTOP_SAFARI_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID_CHROME_UA =
	"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

describe("Readlist onboarding — no installable client", () => {
	it("renders the no-client card (not the Chrome install step) for desktop Safari", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue").set("User-Agent", DESKTOP_SAFARI_UA);

		const doc = new JSDOM(response.text).window.document;
		const noClient = doc.querySelector("[data-test-onboarding-no-client]");
		assert(noClient, "no-client card must render for desktop Safari");
		assert.equal(
			doc.querySelector("[data-test-onboarding-steps]"),
			null,
			"the completion-gated step checklist must not render",
		);
	});

	it("renders the no-client card (not an install step) for Android Chrome, whose app is not advertised", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue").set("User-Agent", ANDROID_CHROME_UA);

		const doc = new JSDOM(response.text).window.document;
		const noClient = doc.querySelector("[data-test-onboarding-no-client]");
		assert(noClient, "no-client card must render while the Android app is unadvertised");
		assert.equal(
			doc.querySelector("[data-test-onboarding-steps]"),
			null,
			"the completion-gated step checklist must not render",
		);
	});

	it("shows a Dismiss button on the no-client card when no dismiss cookie is set", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue").set("User-Agent", DESKTOP_SAFARI_UA);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must be rendered");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);

		const dismiss = doc.querySelector("[data-test-onboarding-no-client] [data-test-onboarding-dismiss]");
		assert(dismiss, "Dismiss button must be rendered on the no-client card");
		const form = dismiss.closest("form");
		assert(form, "Dismiss button must submit a form");
		expect(form.getAttribute("action")).toBe("/queue/dismiss-onboarding?utm_source=onboarding&utm_medium=internal&utm_content=dismiss-no-client");
	});

	it("hides the no-client card when the dismiss cookie matches the stable no-client token", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", DESKTOP_SAFARI_UA)
			.set("Cookie", `${DISMISS_COOKIE_NAME}=${NO_CLIENT_ONBOARDING_VERSION}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must still be rendered so visibility is a state class");
		expect(onboarding.classList.contains("onboarding--hidden")).toBe(true);
	});

	/** The no-client dismissal is decoupled from the step hash: a cookie carrying
	 * ONBOARDING_VERSION (what a client dismissal, or a pre-fix no-client
	 * dismissal, would leave) must NOT hide the no-client card. This is the guard
	 * that editing the onboarding steps — which rotates ONBOARDING_VERSION and
	 * which no-client users never see — can neither dismiss nor re-surface this
	 * unrelated card. */
	it("keeps the no-client card visible when the cookie carries the step-hash version", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", DESKTOP_SAFARI_UA)
			.set("Cookie", `${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must still be rendered");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);
		assert(
			doc.querySelector("[data-test-onboarding-no-client]"),
			"the no-client card must still show — a step-hash cookie is not a no-client dismissal",
		);
	});

	it("POST from a no-client device persists the stable no-client token, not the step hash", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/queue/dismiss-onboarding?utm_source=onboarding&utm_medium=internal&utm_content=dismiss-no-client").set("User-Agent", DESKTOP_SAFARI_UA);

		expect(response.status).toBe(303);
		const cookies = response.headers["set-cookie"];
		assert(cookies, "set-cookie header must be present");
		const cookieStr = Array.isArray(cookies) ? cookies.join("; ") : cookies;
		expect(cookieStr).toContain(`${DISMISS_COOKIE_NAME}=${NO_CLIENT_ONBOARDING_VERSION}`);
		expect(cookieStr).not.toContain(`${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}`);
	});

	it("keeps the no-client card dismissed across a POST→GET round-trip", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		// The POST carries no client UA → the route persists the no-client token.
		const dismiss = await agent.post("/queue/dismiss-onboarding?utm_source=onboarding&utm_medium=internal&utm_content=dismiss-no-client").set("User-Agent", DESKTOP_SAFARI_UA);
		expect(dismiss.status).toBe(303);

		// The agent replays the dismiss cookie on the follow-up no-client render.
		const response = await agent.get("/queue").set("User-Agent", DESKTOP_SAFARI_UA);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must still be rendered");
		expect(onboarding.classList.contains("onboarding--hidden")).toBe(true);
	});
});
