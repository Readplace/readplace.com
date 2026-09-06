import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { NEXT_READ_MINIMUM_SAVES } from "@packages/domain/article";
import { z } from "zod";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
	waitForImagePixels,
} from "@packages/e2e-harness";
import {
	ALIVE_COOKIE_NAME,
	ALIVE_COOKIE_VALUE,
	DISMISS_COOKIE_NAME,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const DESKTOP = { width: 1280, height: 900 };

const ONBOARDING_CARD = "main.readlist .onboarding";
const STEPS_LIST = "main.readlist .onboarding__steps";
const ANY_STEP = "main.readlist [data-test-onboarding-step]";
const COMPLETED_STEP = 'main.readlist [data-test-onboarding-step="install-extension"]';
const OUTSTANDING_STEP =
	'main.readlist [data-test-onboarding-step="save-first-article-via-extension"]';
const SUCCESS_TITLE = "main.readlist .onboarding__success-title";
const SUCCESS_MESSAGE = "main.readlist .onboarding__success-message";
const EMAIL_STEP = 'main.readlist [data-test-onboarding-step="receive-articles-by-email"]';
const NEXT_READ_STEP = 'main.readlist [data-test-onboarding-step="save-enough-for-next-read"]';
const EMAIL_CTA = `${EMAIL_STEP} [data-test-onboarding-action="see-inbox-address"]`;
const EMAIL_MARK_DONE = `${EMAIL_STEP} [data-test-onboarding-action="email-mark-done"]`;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function createVerifiedUser(page: Page, email: string): Promise<string> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	return CreatedUser.parse(await created.json()).userId;
}

/* Seeded rather than saved through the UI: the milestone reads a bounded count
 * of the reader's saves, so the pile only has to exist — driving 50 saves
 * through the save bar would spend minutes to reach the same count. */
async function seedSavesReachingMilestone(page: Page, userId: string): Promise<void> {
	const seeds = Array.from({ length: NEXT_READ_MINIMUM_SAVES }, (_, index) =>
		page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/onboarding-milestone-${index}`,
				title: `Seeded article ${index}`,
				content: "<p>Seeded body for the onboarding milestone baseline.</p>",
				contentFetchedAt: "2026-07-10T09:14:00.000Z",
				savedAt: `2026-07-10T09:${String(index % 60).padStart(2, "0")}:00.000Z`,
				savedByUserId: userId,
				excerpt: "A seeded excerpt.",
			},
		}),
	);
	for (const response of await Promise.all(seeds)) {
		assert.equal(response.status(), 201, "the seed endpoint must create each article");
	}
}

async function seedInboxArticleQueued(page: Page, userId: string): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-inbox-article-queued`, {
		data: { userId },
	});
	assert.equal(response.status(), 201, "the inbox-article seed endpoint must answer 201");
}

async function visibleStepIds(page: Page): Promise<string[]> {
	return page
		.locator(`${ANY_STEP}:visible`)
		.evaluateAll((els) =>
			els.map((el) => el.getAttribute("data-test-onboarding-step") ?? ""),
		);
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function reloadReadlistWithOnboardingCookies(
	page: Page,
	cookies: readonly { name: string; value: string }[],
): Promise<void> {
	await page.context().addCookies(
		cookies.map((cookie) => ({
			...cookie,
			path: "/",
			domain: new URL(BASE_URL).hostname,
		})),
	);
	await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-readlist");
}

async function checklistSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await waitForImagePixels(page, "main.readlist .onboarding__avatar");
	await expect(page.locator(OUTSTANDING_STEP)).toBeVisible();
}

async function completedRowTakesNoSpace(page: Page): Promise<void> {
	const completed = page.locator(COMPLETED_STEP);
	await expect(completed).toBeAttached();
	await expect(completed).toBeHidden();

	const allSteps = await page.locator(ANY_STEP).count();
	const visibleSteps = await page.locator(`${ANY_STEP}:visible`).count();
	assert.equal(
		visibleSteps,
		allSteps - 1,
		"every step but the checked-off one must still occupy the card",
	);

	const list = await measuredBox(page, STEPS_LIST);
	const step = await measuredBox(page, OUTSTANDING_STEP);
	assert.equal(
		step.y,
		list.y,
		"the first outstanding step must start where the list starts, with the completed row above it contributing nothing",
	);
	const completedBox = await page.locator(COMPLETED_STEP).boundingBox();
	assert.equal(completedBox, null, "a checked-off row must have no box at all");
}

async function successSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await waitForImagePixels(page, "main.readlist .onboarding__avatar");
	await expect(page.locator(SUCCESS_TITLE)).toBeVisible();
}

async function welcomeLineStaysHidden(page: Page): Promise<void> {
	const message = page.locator(SUCCESS_MESSAGE);
	await expect(message).toBeAttached();
	await expect(message).toBeHidden();
	const card = await measuredBox(page, ONBOARDING_CARD);
	const title = await measuredBox(page, SUCCESS_TITLE);
	assert.ok(
		title.y >= card.y && title.y + title.height <= card.y + card.height,
		"the success title must sit inside the card",
	);
}

async function emailStepOutstandingSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await waitForImagePixels(page, "main.readlist .onboarding__avatar");
	await expect(page.locator(EMAIL_STEP)).toBeVisible();
	await expect(page.locator(EMAIL_CTA)).toBeVisible();
	await expect(page.locator(EMAIL_MARK_DONE)).toBeVisible();
}

async function emailRowLeadsTheList(page: Page): Promise<void> {
	assert.deepEqual(
		await visibleStepIds(page),
		["receive-articles-by-email", "save-enough-for-next-read"],
		"the email row must lead the outstanding list, with Next Read below it",
	);
	const list = await measuredBox(page, STEPS_LIST);
	const email = await measuredBox(page, EMAIL_STEP);
	const nextRead = await measuredBox(page, NEXT_READ_STEP);
	assert.equal(email.y, list.y, "the email row must start where the list starts");
	assert.ok(nextRead.y >= email.y + email.height, "Next Read must sit below the email row");

	const row = await measuredBox(page, EMAIL_STEP);
	const cta = await measuredBox(page, EMAIL_CTA);
	const markDone = await measuredBox(page, EMAIL_MARK_DONE);
	for (const control of [cta, markDone]) {
		assert.ok(
			control.x >= row.x &&
				control.x + control.width <= row.x + row.width &&
				control.y >= row.y &&
				control.y + control.height <= row.y + row.height,
			"the CTA and mark-done control must sit inside the email row",
		);
	}
	assert.ok(cta.x < markDone.x, "the inbox CTA must lead the mark-done control");
}

async function nextReadIsTheOnlyVisibleRow(page: Page): Promise<void> {
	const email = page.locator(EMAIL_STEP);
	await expect(email).toBeAttached();
	await expect(email).toBeHidden();
	assert.equal(
		await page.locator(EMAIL_STEP).boundingBox(),
		null,
		"a checked-off email row must have no box at all",
	);
	assert.deepEqual(
		await visibleStepIds(page),
		["save-enough-for-next-read"],
		"only the Next Read row may remain visible",
	);
	const list = await measuredBox(page, STEPS_LIST);
	const nextRead = await measuredBox(page, NEXT_READ_STEP);
	assert.equal(nextRead.y, list.y, "Next Read must start where the list starts");
}

async function autoTickedRowTakesNoSpace(page: Page): Promise<void> {
	await expect(page.locator(EMAIL_STEP)).toHaveAttribute("data-test-onboarding-complete", "true");
	await nextReadIsTheOnlyVisibleRow(page);
}

async function nextReadRowSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await waitForImagePixels(page, "main.readlist .onboarding__avatar");
	await expect(page.locator(NEXT_READ_STEP)).toBeVisible();
}

const CHECKLIST_STEP_HIDDEN: VisualCheckpoint = {
	name: "onboarding-completed-step-hidden",
	settled: checklistSettled,
	geometry: completedRowTakesNoSpace,
	target: ONBOARDING_CARD,
	capture: "element",
	pinnedText: [],
};

const EMAIL_STEP_OUTSTANDING: VisualCheckpoint = {
	name: "onboarding-email-step-outstanding",
	settled: emailStepOutstandingSettled,
	geometry: emailRowLeadsTheList,
	target: ONBOARDING_CARD,
	capture: "element",
	pinnedText: [],
};

const EMAIL_STEP_AUTO_TICKED: VisualCheckpoint = {
	name: "onboarding-email-step-auto-ticked",
	settled: nextReadRowSettled,
	geometry: autoTickedRowTakesNoSpace,
	target: ONBOARDING_CARD,
	capture: "element",
	pinnedText: [],
};

const SUCCESS_RETURNING_USER: VisualCheckpoint = {
	name: "onboarding-success-returning-user",
	settled: successSettled,
	geometry: welcomeLineStaysHidden,
	target: ONBOARDING_CARD,
	capture: "element",
	pinnedText: [],
};

test.describe("Onboarding card", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("a checked-off step stops taking up space", async ({ page }, testInfo) => {
		const email = `onboarding-step-hidden-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUser(page, email);
		await loginAs(page, email);
		await reloadReadlistWithOnboardingCookies(page, [
			{ name: ALIVE_COOKIE_NAME, value: ALIVE_COOKIE_VALUE },
		]);

		await captureCheckpoint(page, CHECKLIST_STEP_HIDDEN);
	});

	test("the email step leads the outstanding list with its CTA and mark-done control", async ({ page }, testInfo) => {
		const email = `onboarding-email-outstanding-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUser(page, email);
		await loginAs(page, email);
		await reloadReadlistWithOnboardingCookies(page, [
			{ name: ALIVE_COOKIE_NAME, value: ALIVE_COOKIE_VALUE },
			{ name: SAVE_COOKIE_NAME, value: SAVE_COOKIE_VALUE },
		]);

		await captureCheckpoint(page, EMAIL_STEP_OUTSTANDING);
	});

	test("an auto-ticked email step takes no space", async ({ page }, testInfo) => {
		const email = `onboarding-email-ticked-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const userId = await createVerifiedUser(page, email);
		await seedInboxArticleQueued(page, userId);
		await loginAs(page, email);
		await reloadReadlistWithOnboardingCookies(page, [
			{ name: ALIVE_COOKIE_NAME, value: ALIVE_COOKIE_VALUE },
			{ name: SAVE_COOKIE_NAME, value: SAVE_COOKIE_VALUE },
		]);

		await captureCheckpoint(page, EMAIL_STEP_AUTO_TICKED);
	});

	test("the inbox-article seed endpoint rejects a body with no user", async ({ page }) => {
		const response = await page.request.post(`${BASE_URL}/e2e/seed-inbox-article-queued`, {
			data: {},
		});
		assert.equal(response.status(), 400, "a body without a userId must be rejected");
	});

	test("a returning user's success card carries only the title", async ({ page }, testInfo) => {
		const email = `onboarding-success-returning-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const userId = await createVerifiedUser(page, email);
		// Logging in first renders the checklist with the milestone still to go,
		// which is the sighting that makes finishing it worth congratulating; a
		// readlist seeded deep enough before that would earn no card at all.
		await loginAs(page, email);
		await seedSavesReachingMilestone(page, userId);
		await seedInboxArticleQueued(page, userId);
		await reloadReadlistWithOnboardingCookies(page, [
			{ name: ALIVE_COOKIE_NAME, value: ALIVE_COOKIE_VALUE },
			{ name: SAVE_COOKIE_NAME, value: SAVE_COOKIE_VALUE },
			{ name: DISMISS_COOKIE_NAME, value: "stale-version" },
		]);

		await captureCheckpoint(page, SUCCESS_RETURNING_USER);
	});
});
