import assert from "node:assert/strict";
import { NEXT_READ_MINIMUM_SAVES } from "@packages/domain/article";
import {
	ALIVE_COOKIE_NAME,
	ALIVE_COOKIE_VALUE,
	DISMISS_COOKIE_NAME,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import type { CountArticlesQuery } from "@packages/provider-contracts/article-store";
import type { UserId } from "@packages/domain/user";
import { JSDOM } from "jsdom";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { useTestServer, loginAgent } from "../../../test-app";

const useApp = useTestServer();

const CHROME_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const IPHONE_UA =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
/** Desktop Safari falls into the "other" bucket, which renders the escape card
 * instead of the step list — so it must pay for none of the milestone reads. */
const DESKTOP_SAFARI_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

const EXTENSION_COOKIES = `${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}; ${SAVE_COOKIE_NAME}=${SAVE_COOKIE_VALUE}`;
const NEXT_READ_STEP = '[data-test-onboarding-step="save-enough-for-next-read"]';

interface CountingFixture {
	fixture: ReturnType<typeof createDefaultTestAppFixture>;
	counted: CountArticlesQuery[];
	milestoned: UserId[];
}

/** A fixture whose save count is stubbed to `savedCount`, recording both the
 * count queries and the milestone writes the render performs. Stubbing the count
 * keeps these cases off 50 real saves — the milestone only ever reads a bounded
 * count, so a stubbed one is indistinguishable from a real pile. */
function countingFixture(savedCount: number): CountingFixture {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const counted: CountArticlesQuery[] = [];
	const milestoned: UserId[] = [];
	return {
		counted,
		milestoned,
		fixture: {
			...fixture,
			articleStore: {
				...fixture.articleStore,
				countArticlesByUser: async (query: CountArticlesQuery) => {
					counted.push(query);
					return Math.min(savedCount, query.countLimit ?? savedCount);
				},
			},
			onboardingSignals: {
				...fixture.onboardingSignals,
				recordNextReadMinimumReached: async ({ userId }: { userId: UserId }) => {
					milestoned.push(userId);
					await fixture.onboardingSignals.recordNextReadMinimumReached({ userId });
				},
			},
		},
	};
}

function nextReadStep(html: string): Element {
	const step = new JSDOM(html).window.document.querySelector(NEXT_READ_STEP);
	assert(step, "the Next Read milestone step must be rendered");
	return step;
}

describe("Queue onboarding — Next Read milestone", () => {
	it("renders the step incomplete with a live count for a brand-new account", async () => {
		const harness = useApp(countingFixture(0).fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", CHROME_UA)
			.set("Cookie", EXTENSION_COOKIES);

		const step = nextReadStep(response.text);
		expect(step.getAttribute("data-test-onboarding-complete")).toBe("false");
		expect(step.querySelector(".onboarding__step-description")?.textContent).toContain(
			`You've saved 0 of ${NEXT_READ_MINIMUM_SAVES}.`,
		);
	});

	it("counts the account's real saves into the step copy", async () => {
		const harness = useApp(countingFixture(12).fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", CHROME_UA)
			.set("Cookie", EXTENSION_COOKIES);

		expect(
			nextReadStep(response.text).querySelector(".onboarding__step-description")?.textContent,
		).toContain(`You've saved 12 of ${NEXT_READ_MINIMUM_SAVES}.`);
	});

	it("bounds the count query at the minimum rather than counting the whole queue", async () => {
		const counting = countingFixture(500);
		const harness = useApp(counting.fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		await agent.get("/queue").set("User-Agent", CHROME_UA).set("Cookie", EXTENSION_COOKIES);

		expect(counting.counted).toContainEqual(
			expect.objectContaining({ countLimit: NEXT_READ_MINIMUM_SAVES }),
		);
	});

	it("leaves the step incomplete one save short of the minimum", async () => {
		const counting = countingFixture(NEXT_READ_MINIMUM_SAVES - 1);
		const harness = useApp(counting.fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", CHROME_UA)
			.set("Cookie", EXTENSION_COOKIES);

		expect(nextReadStep(response.text).getAttribute("data-test-onboarding-complete")).toBe("false");
		expect(counting.milestoned).toEqual([]);
	});

	it("completes the step and stamps the milestone once at the minimum", async () => {
		const counting = countingFixture(NEXT_READ_MINIMUM_SAVES);
		const harness = useApp(counting.fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue").set("User-Agent", CHROME_UA);

		expect(nextReadStep(response.text).getAttribute("data-test-onboarding-complete")).toBe("true");
		expect(counting.milestoned).toHaveLength(1);
	});

	it("reaches the success card only once the milestone joins the two device steps", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		let savedCount = 3;
		const harness = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				countArticlesByUser: async (query: CountArticlesQuery) =>
					Math.min(savedCount, query.countLimit ?? savedCount),
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);
		// The reader has to have seen the step outstanding for finishing it to
		// mean anything; a queue that was already deep enough earns no card.
		await agent.get("/queue").set("User-Agent", CHROME_UA).set("Cookie", EXTENSION_COOKIES);
		savedCount = NEXT_READ_MINIMUM_SAVES;

		const response = await agent
			.get("/queue")
			.set("User-Agent", CHROME_UA)
			.set("Cookie", EXTENSION_COOKIES);

		const doc = new JSDOM(response.text).window.document;
		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		expect(container.classList.contains("onboarding--complete")).toBe(true);
		assert(doc.querySelector("[data-test-onboarding-success]"), "success card must be rendered");
		expect(doc.querySelectorAll("[data-test-onboarding-dismiss]")).toHaveLength(1);
	});

	it("keeps the card away from a reader whose queue was already deep enough", async () => {
		const harness = useApp(countingFixture(NEXT_READ_MINIMUM_SAVES).fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", CHROME_UA)
			.set("Cookie", EXTENSION_COOKIES);

		const doc = new JSDOM(response.text).window.document;
		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must still be rendered");
		expect(container.classList.contains("onboarding--hidden")).toBe(true);
	});

	it("stops issuing the count query on renders after the milestone is stamped", async () => {
		const counting = countingFixture(NEXT_READ_MINIMUM_SAVES);
		const harness = useApp(counting.fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.get("/queue").set("User-Agent", CHROME_UA).set("Cookie", EXTENSION_COOKIES);
		const afterFirstRender = counting.counted.length;

		await agent.get("/queue").set("User-Agent", CHROME_UA).set("Cookie", EXTENSION_COOKIES);

		const milestoneCounts = counting.counted
			.slice(afterFirstRender)
			.filter((query) => query.countLimit === NEXT_READ_MINIMUM_SAVES);
		expect(milestoneCounts).toEqual([]);
		expect(counting.milestoned).toHaveLength(1);
	});

	it("keeps the step complete after the reader deletes back below the minimum", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		let savedCount = NEXT_READ_MINIMUM_SAVES;
		const harness = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				countArticlesByUser: async (query: CountArticlesQuery) =>
					Math.min(savedCount, query.countLimit ?? savedCount),
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.get("/queue").set("User-Agent", CHROME_UA);

		savedCount = 3;
		const response = await agent.get("/queue").set("User-Agent", CHROME_UA);

		expect(nextReadStep(response.text).getAttribute("data-test-onboarding-complete")).toBe("true");
	});

	it("still renders the queue when stamping the milestone throws", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errorArgs: unknown[] = [];
		const harness = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				countArticlesByUser: async () => NEXT_READ_MINIMUM_SAVES,
			},
			onboardingSignals: {
				...fixture.onboardingSignals,
				recordNextReadMinimumReached: async () => {
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

		expect(response.status).toBe(200);
		expect(nextReadStep(response.text).getAttribute("data-test-onboarding-complete")).toBe("true");
		expect(errorArgs).toEqual([["Failed to record onboarding signal", "dynamo down"]]);
	});

	it("holds back the dismiss control while only the milestone is outstanding", async () => {
		const harness = useApp(countingFixture(3).fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", CHROME_UA)
			.set("Cookie", EXTENSION_COOKIES);

		const doc = new JSDOM(response.text).window.document;
		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		expect(container.classList.contains("onboarding--visible")).toBe(true);
		expect(doc.querySelectorAll("[data-test-onboarding-dismiss]")).toHaveLength(0);
	});

	it("re-shows the checklist to a reader who dismissed the previous step set", async () => {
		const harness = useApp(countingFixture(3).fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", CHROME_UA)
			.set("Cookie", `${DISMISS_COOKIE_NAME}=stale-version; ${EXTENSION_COOKIES}`);

		const container = new JSDOM(response.text).window.document.querySelector(
			"[data-test-onboarding]",
		);
		assert(container, "onboarding container must be rendered");
		expect(container.classList.contains("onboarding--visible")).toBe(true);
		expect(nextReadStep(response.text).getAttribute("data-test-onboarding-complete")).toBe("false");
	});

	it("reads the onboarding row once per render on iPhone, not once per signal", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const reads: UserId[] = [];
		const harness = useApp({
			...fixture,
			onboardingSignals: {
				...fixture.onboardingSignals,
				getOnboardingSignals: async ({ userId }: { userId: UserId }) => {
					reads.push(userId);
					return fixture.onboardingSignals.getOnboardingSignals({ userId });
				},
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);

		await agent.get("/queue").set("User-Agent", IPHONE_UA);

		expect(reads).toHaveLength(1);
	});

	it("makes neither onboarding read on a device with no installable client", async () => {
		const counting = countingFixture(0);
		const fixture = counting.fixture;
		const reads: UserId[] = [];
		const harness = useApp({
			...fixture,
			onboardingSignals: {
				...fixture.onboardingSignals,
				getOnboardingSignals: async ({ userId }: { userId: UserId }) => {
					reads.push(userId);
					return fixture.onboardingSignals.getOnboardingSignals({ userId });
				},
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue").set("User-Agent", DESKTOP_SAFARI_UA);

		expect(reads).toEqual([]);
		expect(
			counting.counted.filter((query) => query.countLimit === NEXT_READ_MINIMUM_SAVES),
		).toEqual([]);
		const doc = new JSDOM(response.text).window.document;
		assert(
			doc.querySelector("[data-test-onboarding-no-client]"),
			"a no-client device must still get the escape card",
		);
	});
});
