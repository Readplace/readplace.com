import assert from "node:assert/strict";
import { NEXT_READ_MINIMUM_SAVES } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { CountArticlesQuery } from "@packages/provider-contracts/article-store";
import {
	ALIVE_COOKIE_NAME,
	ALIVE_COOKIE_VALUE,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { ONBOARDING_VERSION } from "../../onboarding/onboarding.steps";
import { useTestServer, loginAgent, type TestAppHarness } from "../../../test-app";

const useApp = useTestServer();

const CHROME_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const IPHONE_UA =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const DESKTOP_SAFARI_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

const EXTENSION_COOKIES = `${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}; ${SAVE_COOKIE_NAME}=${SAVE_COOKIE_VALUE}`;
const EMAIL_STEP = '[data-test-onboarding-step="receive-articles-by-email"]';
const MARK_DONE_PATH = "/queue/onboarding/email/done";

function versionStampingFixture(savedCount: number) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const versionWrites: { userId: UserId; version: string }[] = [];
	return {
		versionWrites,
		fixture: {
			...fixture,
			articleStore: {
				...fixture.articleStore,
				countArticlesByUser: async (query: CountArticlesQuery) =>
					Math.min(savedCount, query.countLimit ?? savedCount),
			},
			onboardingSignals: {
				...fixture.onboardingSignals,
				recordOnboardingOutstandingVersion: async (params: { userId: UserId; version: string }) => {
					versionWrites.push(params);
					await fixture.onboardingSignals.recordOnboardingOutstandingVersion(params);
				},
			},
		},
	};
}

async function userIdOf(harness: TestAppHarness): Promise<UserId> {
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist");
	return user.userId;
}

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function emailStepOf(html: string): Element {
	const step = parse(html).querySelector(EMAIL_STEP);
	assert(step, "the email step must be rendered");
	return step;
}

function stepIds(html: string): string[] {
	return Array.from(parse(html).querySelectorAll("[data-test-onboarding-step]")).map(
		(el) => el.getAttribute("data-test-onboarding-step") ?? "",
	);
}

describe("Readlist onboarding — Get articles from email", () => {
	it("renders the email step outstanding with its inbox CTA and mark-done for a fresh account", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue").set("User-Agent", CHROME_UA);

		const step = emailStepOf(response.text);
		assert.equal(step.getAttribute("data-test-onboarding-complete"), "false");
		const keys = Array.from(step.querySelectorAll("[data-test-onboarding-action]")).map((el) =>
			el.getAttribute("data-test-onboarding-action"),
		);
		assert.deepEqual(keys, ["see-inbox-address", "email-mark-done"]);
		assert.equal(
			step.querySelector('[data-test-onboarding-action="see-inbox-address"]')?.closest("form")?.getAttribute("action"),
			"/inbox/addresses",
		);
		assert.equal(
			step.querySelector('[data-test-onboarding-action="email-mark-done"]')?.closest("form")?.getAttribute("action"),
			MARK_DONE_PATH,
		);
	});

	it("ticks the step from the account's first inbox article on any device", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);
		await fixture.onboardingSignals.recordInboxArticleQueued({ userId });

		const chrome = await agent.get("/queue").set("User-Agent", CHROME_UA);
		assert.equal(emailStepOf(chrome.text).getAttribute("data-test-onboarding-complete"), "true");

		const iphone = await agent.get("/queue").set("User-Agent", IPHONE_UA);
		assert.equal(emailStepOf(iphone.text).getAttribute("data-test-onboarding-complete"), "true");
	});

	it("marks the step done and returns to the readlist", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);

		const redirect = await agent.post(MARK_DONE_PATH).set("User-Agent", CHROME_UA);
		assert.equal(redirect.status, 303);
		assert.equal(redirect.headers.location, "/queue");

		const signals = await fixture.onboardingSignals.getOnboardingSignals({ userId });
		assert(signals.emailStepMarkedDoneAt instanceof Date, "the marked-done instant must be stamped");

		const after = await agent.get("/queue").set("User-Agent", CHROME_UA);
		const step = parse(after.text).querySelector(EMAIL_STEP);
		assert(step, "the email step must still render, checked off");
		assert.equal(step.getAttribute("data-test-onboarding-complete"), "true");
	});

	it("carries the readlist state back through the mark-done redirect", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const redirect = await agent.post(`${MARK_DONE_PATH}?tab=done`).set("User-Agent", CHROME_UA);

		assert.equal(redirect.status, 303);
		assert.equal(redirect.headers.location, "/queue?tab=done");
	});

	it("sends an anonymous mark-done to login without stamping", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const markedDone: UserId[] = [];
		const harness = useApp({
			...fixture,
			onboardingSignals: {
				...fixture.onboardingSignals,
				recordEmailStepMarkedDone: async ({ userId }: { userId: UserId }) => {
					markedDone.push(userId);
				},
			},
		});

		const response = await request(harness.server).post(MARK_DONE_PATH).set("User-Agent", CHROME_UA);

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/login");
		assert.deepEqual(markedDone, []);
	});

	it("answers 500 rather than redirecting when the mark-done write fails", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp({
			...fixture,
			onboardingSignals: {
				...fixture.onboardingSignals,
				recordEmailStepMarkedDone: async () => {
					throw new Error("dynamo down");
				},
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post(MARK_DONE_PATH).set("User-Agent", CHROME_UA);

		assert.equal(response.status, 500);
	});

	it("hides the card with no success when every step, the email one included, was satisfied before the reader saw it", async () => {
		const stamping = versionStampingFixture(NEXT_READ_MINIMUM_SAVES);
		const harness = useApp(stamping.fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);
		await stamping.fixture.onboardingSignals.recordEmailStepMarkedDone({ userId });

		const response = await agent
			.get("/queue")
			.set("User-Agent", CHROME_UA)
			.set("Cookie", EXTENSION_COOKIES);

		const container = parse(response.text).querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must still be rendered");
		assert(container.classList.contains("onboarding--hidden"));
		assert(!container.classList.contains("onboarding--complete"));
	});

	it("keeps the checklist for a reader who marked the email step done with steps still to do", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);
		await fixture.onboardingSignals.recordEmailStepMarkedDone({ userId });

		const response = await agent.get("/queue").set("User-Agent", CHROME_UA);

		const container = parse(response.text).querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--visible"));
		assert.deepEqual(stepIds(response.text), [
			"install-extension",
			"save-first-article-via-extension",
			"receive-articles-by-email",
			"save-enough-for-next-read",
		]);
		assert.equal(emailStepOf(response.text).getAttribute("data-test-onboarding-complete"), "true");
	});

	it("keeps the step done across a different device and a stale stored version", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);
		await fixture.onboardingSignals.recordOnboardingOutstandingVersion({
			userId,
			version: "stale-version",
		});
		await fixture.onboardingSignals.recordEmailStepMarkedDone({ userId });

		const chrome = await agent.get("/queue").set("User-Agent", CHROME_UA);
		assert.equal(emailStepOf(chrome.text).getAttribute("data-test-onboarding-complete"), "true");

		const iphone = await agent.get("/queue").set("User-Agent", IPHONE_UA);
		assert.equal(emailStepOf(iphone.text).getAttribute("data-test-onboarding-complete"), "true");
	});

	it("stamps the checklist version once the reader has seen a step outstanding, and only once", async () => {
		const stamping = versionStampingFixture(0);
		const harness = useApp(stamping.fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);

		await agent.get("/queue").set("User-Agent", CHROME_UA);
		await agent.get("/queue").set("User-Agent", CHROME_UA);

		assert.deepEqual(stamping.versionWrites, [{ userId, version: ONBOARDING_VERSION }]);
	});

	it("writes the version stamp from the save-bar re-render too", async () => {
		const stamping = versionStampingFixture(0);
		const harness = useApp(stamping.fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);

		const rejected = await agent
			.post("/queue/save")
			.set("User-Agent", CHROME_UA)
			.type("form")
			.send({ url: "not-a-url" });
		assert.equal(rejected.status, 422);

		assert.deepEqual(stamping.versionWrites, [{ userId, version: ONBOARDING_VERSION }]);

		await agent.get("/queue").set("User-Agent", CHROME_UA);
		assert.equal(stamping.versionWrites.length, 1);
	});

	it("never stamps, and hides the card, for a reader whose four steps were done on first sight", async () => {
		const stamping = versionStampingFixture(NEXT_READ_MINIMUM_SAVES);
		const harness = useApp(stamping.fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);
		await stamping.fixture.onboardingSignals.recordInboxArticleQueued({ userId });

		const response = await agent
			.get("/queue")
			.set("User-Agent", CHROME_UA)
			.set("Cookie", EXTENSION_COOKIES);

		assert.deepEqual(stamping.versionWrites, []);
		const container = parse(response.text).querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--hidden"));
	});

	it("keeps the card hidden when the stored version is stale but nothing is outstanding", async () => {
		const stamping = versionStampingFixture(NEXT_READ_MINIMUM_SAVES);
		const harness = useApp(stamping.fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);
		await stamping.fixture.onboardingSignals.recordInboxArticleQueued({ userId });
		await stamping.fixture.onboardingSignals.recordOnboardingOutstandingVersion({
			userId,
			version: "stale-version",
		});
		stamping.versionWrites.length = 0;

		const response = await agent
			.get("/queue")
			.set("User-Agent", CHROME_UA)
			.set("Cookie", EXTENSION_COOKIES);

		assert.deepEqual(stamping.versionWrites, []);
		const container = parse(response.text).querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--hidden"));
	});

	it("congratulates a reader who was shown the email step and then received an inbox article", async () => {
		const stamping = versionStampingFixture(NEXT_READ_MINIMUM_SAVES);
		const harness = useApp(stamping.fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);

		const first = await agent
			.get("/queue")
			.set("User-Agent", CHROME_UA)
			.set("Cookie", EXTENSION_COOKIES);
		assert.equal(emailStepOf(first.text).getAttribute("data-test-onboarding-complete"), "false");

		await stamping.fixture.onboardingSignals.recordInboxArticleQueued({ userId });

		const second = await agent
			.get("/queue")
			.set("User-Agent", CHROME_UA)
			.set("Cookie", EXTENSION_COOKIES);

		const doc = parse(second.text);
		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--complete"));
		assert(doc.querySelector("[data-test-onboarding-success]"), "success card must be rendered");
		assert.equal(doc.querySelectorAll("[data-test-onboarding-dismiss]").length, 1);
	});

	it("congratulates a reader who marks the email step done and then finishes the rest", async () => {
		const stamping = versionStampingFixture(NEXT_READ_MINIMUM_SAVES);
		const harness = useApp(stamping.fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);

		await agent.post(MARK_DONE_PATH).set("User-Agent", CHROME_UA);
		const stillOpen = await agent.get("/queue").set("User-Agent", CHROME_UA);
		const openContainer = parse(stillOpen.text).querySelector("[data-test-onboarding]");
		assert(openContainer, "onboarding container must be rendered");
		assert(openContainer.classList.contains("onboarding--visible"));
		assert.deepEqual(stamping.versionWrites, [{ userId, version: ONBOARDING_VERSION }]);

		const finished = await agent
			.get("/queue")
			.set("User-Agent", CHROME_UA)
			.set("Cookie", EXTENSION_COOKIES);

		const doc = parse(finished.text);
		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--complete"));
		assert(doc.querySelector("[data-test-onboarding-success]"), "success card must be rendered");
	});

	it("makes no version write on a device with no installable client", async () => {
		const stamping = versionStampingFixture(0);
		const harness = useApp(stamping.fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		await agent.get("/queue").set("User-Agent", DESKTOP_SAFARI_UA);

		assert.deepEqual(stamping.versionWrites, []);
	});

	it("still renders the readlist when the version write throws", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errorArgs: unknown[] = [];
		const harness = useApp({
			...fixture,
			onboardingSignals: {
				...fixture.onboardingSignals,
				recordOnboardingOutstandingVersion: async () => {
					throw new Error("dynamo down");
				},
			},
			shared: {
				...fixture.shared,
				logError: (msg: string, err?: Error) => {
					errorArgs.push([msg, err?.message]);
				},
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue").set("User-Agent", CHROME_UA);

		assert.equal(response.status, 200);
		assert.deepEqual(errorArgs, [["Failed to record onboarding signal", "dynamo down"]]);
	});
});
