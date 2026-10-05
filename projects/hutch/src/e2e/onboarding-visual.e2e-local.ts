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

const ONBOARDING_CARD = "main.readlist [data-test-setup-guide]";
const STEPS_LIST = "main.readlist .setup-guide__steps";
const ANY_STEP = "main.readlist [data-test-onboarding-step]";

const ALL_STEP_IDS = [
	"install-extension",
	"save-first-article-via-extension",
	"receive-articles-by-email",
	"save-enough-for-next-read",
] as const;

function stepSelector(id: (typeof ALL_STEP_IDS)[number]): string {
	return `main.readlist [data-test-onboarding-step="${id}"]`;
}

const INSTALL_STEP = stepSelector("install-extension");
const SAVE_STEP = stepSelector("save-first-article-via-extension");
const SUCCESS_TITLE = "main.readlist .setup-guide__success-title";
const SUCCESS_MESSAGE = "main.readlist .setup-guide__success-message";
const EMAIL_STEP = stepSelector("receive-articles-by-email");
const NEXT_READ_STEP = stepSelector("save-enough-for-next-read");
const EMAIL_CTA = `${EMAIL_STEP} [data-test-onboarding-action="see-inbox-address"]`;
const EMAIL_MARK_DONE = `${EMAIL_STEP} [data-test-onboarding-action="email-mark-done"]`;

const DESKTOP_SAFARI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function createVerifiedUser(page: Page, email: string): Promise<string> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const userId = CreatedUser.parse(await created.json()).userId;
	// These baselines cover the original checklist for accounts without Gmail access.
	const subscription = await page.request.post(`${BASE_URL}/e2e/seed-subscription-state`, {
		data: { userId, state: "trialing" },
	});
	assert.equal(subscription.status(), 201);
	return userId;
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

async function stepIdsUnder(page: Page, selector: string): Promise<string[]> {
	return page
		.locator(selector)
		.evaluateAll((els) =>
			els.map((el) => el.getAttribute("data-test-onboarding-step") ?? ""),
		);
}

async function openStepIds(page: Page): Promise<string[]> {
	return stepIdsUnder(page, `${ANY_STEP}:has(details[open])`);
}

async function onlyStepOpen(page: Page, id: (typeof ALL_STEP_IDS)[number]): Promise<void> {
	assert.deepEqual(
		await stepIdsUnder(page, ANY_STEP),
		[...ALL_STEP_IDS],
		"every step must still render, in order",
	);
	assert.deepEqual(await openStepIds(page), [id], `only ${id} may be expanded`);
	assert.deepEqual(
		await stepIdsUnder(page, `${ANY_STEP}[data-test-onboarding-current="true"]`),
		[id],
		`only ${id} may be marked as the step being asked for`,
	);
	for (const other of ALL_STEP_IDS.filter((stepId) => stepId !== id)) {
		const row = page.locator(stepSelector(other));
		await expect(row).toBeVisible();
		await expect(row.locator("details")).not.toHaveAttribute("open", "");
	}
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
	await expect(page.locator(SAVE_STEP)).toBeVisible();
}

async function completedRowCollapses(page: Page): Promise<void> {
	await expect(page.locator(INSTALL_STEP)).toHaveAttribute(
		"data-test-onboarding-complete",
		"true",
	);
	await onlyStepOpen(page, "save-first-article-via-extension");
	await stepAnatomyHolds(page, 488);
}

async function installStepSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await expect(page.locator(INSTALL_STEP)).toBeVisible();
}

async function installRowStandsAlone(page: Page): Promise<void> {
	await expect(page.locator(INSTALL_STEP)).toHaveAttribute(
		"data-test-onboarding-complete",
		"false",
	);
	await onlyStepOpen(page, "install-extension");
	await stepAnatomyHolds(page, 508);
}

async function successSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
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
	await expect(page.locator(EMAIL_STEP)).toBeVisible();
	await expect(page.locator(EMAIL_CTA)).toBeVisible();
	await expect(page.locator(EMAIL_MARK_DONE)).toBeVisible();
}

async function emailRowStandsAlone(page: Page): Promise<void> {
	await onlyStepOpen(page, "receive-articles-by-email");
	await stepAnatomyHolds(page, 576);

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
	assert.ok(
		cta.y + cta.height <= markDone.y || cta.x < markDone.x,
		"the inbox CTA must lead the mark-done control",
	);
}

async function nextReadIsTheOnlyOpenRow(page: Page): Promise<void> {
	await onlyStepOpen(page, "save-enough-for-next-read");

	const list = await measuredBox(page, STEPS_LIST);
	const nextRead = await measuredBox(page, NEXT_READ_STEP);
	assert.ok(
		nextRead.y >= list.y && nextRead.y + nextRead.height <= list.y + list.height,
		"Next Read must sit inside the step list",
	);
}

async function autoTickedRowCollapses(page: Page): Promise<void> {
	await expect(page.locator(EMAIL_STEP)).toHaveAttribute("data-test-onboarding-complete", "true");
	await nextReadIsTheOnlyOpenRow(page);
	await stepAnatomyHolds(page, 542);
}

async function nextReadRowSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await expect(page.locator(NEXT_READ_STEP)).toBeVisible();
}

async function stepAnatomyHolds(page: Page, expectedHeight: number): Promise<void> {
	const card = await measuredBox(page, ONBOARDING_CARD);
	const title = await measuredBox(page, `${ONBOARDING_CARD} > .setup-guide__header .setup-guide__title`);
	const list = await measuredBox(page, STEPS_LIST);
	const label = await measuredBox(page, ".setup-guide__progress-label");
	const track = await measuredBox(page, ".setup-guide__progress-track");
	assert.ok(Math.abs(card.width - 340) <= 1, "the desktop track must size the guide to 340px");
	assert.ok(Math.abs(card.height - expectedHeight) <= 2, `the guide must measure ${expectedHeight}px, measured ${card.height}px`);
	assert.ok(Math.abs(title.x - card.x - 21) <= 1, "the heading must have a 20px inset inside the border");
	assert.ok(Math.abs(list.x - card.x - 1) <= 1, "the divider must begin at the card's inner edge");
	assert.ok(Math.abs(list.width - card.width + 2) <= 1, "the divider must span the card's inner width");
	assert.ok(Math.abs(list.y - card.y - 160) <= 1, "the header and progress section must be 160px high");
	assert.equal(await page.locator(STEPS_LIST).evaluate((el) => getComputedStyle(el).borderTopWidth), "1px");
	assert.ok(Math.abs(track.y - label.y - label.height - 12) <= 1, "the bar must sit 12px below the progress label");
	assert.equal(track.height, 6, "the progress bar must stay 6px high");
	const foldChevron = await measuredBox(page, ".setup-guide__progress-row .setup-guide__chevron svg");
	assert.ok(Math.abs(foldChevron.width - 24) <= 1 && Math.abs(foldChevron.height - 24) <= 1, "the fold chevron must draw a 24px glyph");
	let previousMarkerBottom = list.y;
	for (const id of ALL_STEP_IDS) {
		const row = stepSelector(id);
		const summary = await measuredBox(page, `${row} .setup-guide__summary`);
		const stepTitle = await measuredBox(page, `${row} .setup-guide__step-title`);
		const titleRow = await measuredBox(page, `${row} .setup-guide__summary-label`);
		const marker = await measuredBox(page, `${row} .setup-guide__marker`);
		const chevron = await measuredBox(page, `${row} .setup-guide__chevron svg`);
		assert.ok(Math.abs(chevron.width - 24) <= 1 && Math.abs(chevron.height - 24) <= 1, "each step chevron must draw a 24px glyph");
		assert.ok(Math.abs(stepTitle.x - summary.x - 40) <= 1, "the title must sit 40px after the marker slot's leading edge");
		assert.ok(Math.abs(marker.x - summary.x - 2) <= 1, "the 20px marker must sit inside its 24px slot");
		assert.equal(marker.width, 20);
		assert.equal(marker.height, 20);
		assert.ok(summary.height >= 44, "each summary must keep a 44px hit area");
		assert.ok(titleRow.height >= 24, "the title row must fill its 24px slot");
		assert.ok(marker.y >= previousMarkerBottom, "consecutive marker slots must be at least 24px apart");
		previousMarkerBottom = marker.y + 24;
	}
	const emailTitleRow = await measuredBox(page, `${EMAIL_STEP} .setup-guide__summary-label`);
	assert.ok(Math.abs(emailTitleRow.height - 24) <= 1, "a one-line title must paint a 24px row");
	for (const check of await page.locator(".setup-guide__marker--complete svg").all()) {
		const glyph = await check.boundingBox();
		assert(glyph, "each completed marker must paint its check");
		const marker = await check.locator("..").boundingBox();
		assert(marker, "each check must sit inside its marker");
		assert.ok(glyph.width === 12 && glyph.height === 12, "the completed check must paint Figma's 7×5 tick from a 12px glyph box");
		assert.ok(glyph.x >= marker.x && glyph.x + glyph.width <= marker.x + marker.width);
		assert.ok(glyph.y >= marker.y && glyph.y + glyph.height <= marker.y + marker.height);
	}
}

async function noClientSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await expect(page.locator("[data-test-onboarding-no-client]")).toBeVisible();
}

async function noClientUsesItsOwnPadding(page: Page): Promise<void> {
	const card = await measuredBox(page, ONBOARDING_CARD);
	const title = await measuredBox(page, `${ONBOARDING_CARD} .setup-guide__title`);
	const cta = await measuredBox(page, '[data-test-onboarding-action="see-install-options"]');
	assert.ok(Math.abs(title.x - card.x - 21) <= 1, "the no-client title must use its own 20px padding");
	assert.ok(Math.abs(cta.width - card.width + 42) <= 1, "the install button must fill the no-client content width");
	assert.ok(Math.abs(cta.x - card.x - 21) <= 1, "the full-width install button must align with the title");
}

const NO_CLIENT: VisualCheckpoint = {
	name: "onboarding-no-client",
	settled: noClientSettled,
	geometry: noClientUsesItsOwnPadding,
	target: ONBOARDING_CARD,
	capture: "element",
	pinnedText: [],
};

const CHECKLIST_STEP_HIDDEN: VisualCheckpoint = {
	name: "onboarding-completed-step-hidden",
	settled: checklistSettled,
	geometry: completedRowCollapses,
	target: ONBOARDING_CARD,
	capture: "element",
	pinnedText: [],
};

const FIRST_RUN_INSTALL_STEP: VisualCheckpoint = {
	name: "onboarding-first-run-install-step",
	settled: installStepSettled,
	geometry: installRowStandsAlone,
	target: ONBOARDING_CARD,
	capture: "element",
	pinnedText: [],
};

const EMAIL_STEP_OUTSTANDING: VisualCheckpoint = {
	name: "onboarding-email-step-outstanding",
	settled: emailStepOutstandingSettled,
	geometry: emailRowStandsAlone,
	target: ONBOARDING_CARD,
	capture: "element",
	pinnedText: [],
};

const EMAIL_STEP_AUTO_TICKED: VisualCheckpoint = {
	name: "onboarding-email-step-auto-ticked",
	settled: nextReadRowSettled,
	geometry: autoTickedRowCollapses,
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

	test("a brand-new reader is asked the install step only", async ({ page }, testInfo) => {
		const email = `onboarding-first-run-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUser(page, email);
		await loginAs(page, email);

		await captureCheckpoint(page, FIRST_RUN_INSTALL_STEP);
	});

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

test.describe("Onboarding on a device without a client", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP, userAgent: DESKTOP_SAFARI_UA });

	test("keeps the no-client card's title and install button on its own padding", async ({ page }, testInfo) => {
		const email = `onboarding-no-client-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUser(page, email);
		await loginAs(page, email);
		await captureCheckpoint(page, NO_CLIENT);
	});
});
