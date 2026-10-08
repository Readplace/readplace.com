import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { pageOverflowsSideways } from "./page-measurements.browser";
import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "../runtime/web/shared/save-tip/save-tip-cookie";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";

const PANEL = '[data-test-confirm-popover="subscribe-plans"]';
const PLANS_PAGE = "[data-test-plans-page]";
const OPEN_TRIGGER = '[data-test-action="subscribe-plans-open"]';
const DISMISS = '[data-test-action="subscribe-plans-dismiss"]';
const SUBMIT = '[data-test-action="subscribe-plans-submit"]';
const PLAN_KEYS = ["yearly", "monthly", "triennial"] as const;
const ROW_GAP = 12;
const DESIGNED_ROW_HEIGHT = 77;

const TRIAL_TILES_PINNED = [
	{ selector: '[data-test-trial-tile="days"]', text: "9" },
	{ selector: '[data-test-trial-tile="hours"]', text: "23" },
	{ selector: '[data-test-trial-tile="minutes"]', text: "18" },
];

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface PlanFormBoxes {
	rows: Box[];
	texts: Box[];
	billed: Box[];
	prices: Box[];
	badge: Box;
	submit: Box;
}

interface PanelRelativeBoxes {
	rows: Box[];
	badge: Box;
	buttons: Box[];
}

async function signInTrialingReader(page: Page, stamp: string): Promise<void> {
	const email = `subscribe-plans-visual-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-subscription-state`, {
		data: { userId, state: "trialing" },
	});
	assert.equal(seeded.status(), 201, "the subscription-state seed endpoint must answer 201");

	await page.context().addCookies([{ name: SAVE_TIP_COOKIE_NAME, value: SAVE_TIP_SEEN, url: BASE_URL }]);
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function openPlansDialog(page: Page, input: { path: string; bodyClass: string }): Promise<void> {
	await page.goto(`${BASE_URL}${input.path}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(`body.${input.bodyClass}`);
	await page.click(OPEN_TRIGGER);
	await page.waitForSelector(`${PANEL}:popover-open`);
}

async function dialogOpen(page: Page): Promise<void> {
	await page.waitForSelector(`${PANEL}:popover-open`);
	await page.mouse.move(5, 5);
	await waitForBrandFonts(page, ["Inter"]);
}

async function planFormBoxes(page: Page, root: string): Promise<PlanFormBoxes> {
	const boxesOf = (part: string) =>
		Promise.all(PLAN_KEYS.map((key) => measuredBox(page, `${root} [data-test-plan="${key}"] ${part}`)));
	return {
		rows: await boxesOf(".subscribe-plans__row"),
		texts: await boxesOf(".subscribe-plans__text"),
		billed: await boxesOf(".subscribe-plans__billed"),
		prices: await boxesOf(".subscribe-plans__price"),
		badge: await measuredBox(page, `${root} [data-test-plan="${PLAN_KEYS[0]}"] [data-test-plan-badge]`),
		submit: await measuredBox(page, `${root} ${SUBMIT}`),
	};
}

function rowsStackInOneColumn(rows: readonly Box[]): void {
	const [first, ...rest] = rows;
	rest.forEach((row, index) => {
		const above = rows[index];
		const gap = row.y - (above.y + above.height);
		assert.ok(Math.abs(row.x - first.x) <= 0.5, `row ${index + 1} starts at x ${row.x}, the first at ${first.x}`);
		assert.ok(Math.abs(row.width - first.width) <= 0.5, `row ${index + 1} is ${row.width}px wide, the first ${first.width}px`);
		assert.ok(Math.abs(gap - ROW_GAP) <= 0.5, `rows ${index} and ${index + 1} are ${gap}px apart`);
	});
}

function tabSitsOnFeaturedRow(boxes: PlanFormBoxes): void {
	const [featured] = boxes.rows;
	const { badge } = boxes;
	assert.ok(
		Math.abs(badge.y + badge.height - featured.y) <= 0.5,
		`the tab ends at y ${badge.y + badge.height}, the featured row starts at ${featured.y}`,
	);
	assert.ok(Math.abs(badge.x - featured.x) <= 0.5, `the tab starts at x ${badge.x}, the featured row at ${featured.x}`);
}

function pricesSitBesideTheirText(boxes: PlanFormBoxes): void {
	boxes.prices.forEach((price, index) => {
		const text = boxes.texts[index];
		assert.ok(price.x >= text.x + text.width, `price ${index} starts at x ${price.x}, inside its text column`);
	});
}

function pricesSitUnderTheirBilledLines(boxes: PlanFormBoxes): void {
	boxes.prices.forEach((price, index) => {
		const billed = boxes.billed[index];
		assert.ok(
			price.y >= billed.y + billed.height - 0.5,
			`price ${index} starts at y ${price.y}, above its billed line's bottom at ${billed.y + billed.height}`,
		);
	});
}

function submitIsFlushWithTheRows(boxes: PlanFormBoxes): void {
	const [row] = boxes.rows;
	const { submit } = boxes;
	assert.ok(
		Math.abs(submit.x + submit.width - (row.x + row.width)) <= 0.5,
		`Subscribe now ends at x ${submit.x + submit.width}, the rows at ${row.x + row.width}`,
	);
}

function partsSitInsidePanel(panel: Box, parts: readonly Box[]): void {
	for (const part of parts) {
		assert.ok(
			part.x >= panel.x && part.x + part.width <= panel.x + panel.width,
			`a part spanning x ${part.x}–${part.x + part.width} leaves the panel at ${panel.x}–${panel.x + panel.width}`,
		);
		assert.ok(
			part.y >= panel.y && part.y + part.height <= panel.y + panel.height,
			`a part spanning y ${part.y}–${part.y + part.height} leaves the panel at ${panel.y}–${panel.y + panel.height}`,
		);
	}
}

function relativeTo(panel: Box, box: Box): Box {
	return { x: box.x - panel.x, y: box.y - panel.y, width: box.width, height: box.height };
}

async function desktopDialogGeometry(page: Page): Promise<PanelRelativeBoxes> {
	const panel = await measuredBox(page, PANEL);
	const boxes = await planFormBoxes(page, PANEL);
	const dismiss = await measuredBox(page, `${PANEL} ${DISMISS}`);

	assert.equal(Math.round(panel.width), 600);
	rowsStackInOneColumn(boxes.rows);
	tabSitsOnFeaturedRow(boxes);
	pricesSitBesideTheirText(boxes);
	for (const row of boxes.rows) {
		assert.ok(Math.abs(row.height - DESIGNED_ROW_HEIGHT) <= 1, `a plan row is ${row.height}px tall`);
	}
	assert.ok(Math.abs(dismiss.y - boxes.submit.y) <= 0.5, "Cancel and Subscribe now must share one row");
	assert.ok(dismiss.x + dismiss.width < boxes.submit.x, "Cancel must sit left of Subscribe now");
	submitIsFlushWithTheRows(boxes);
	partsSitInsidePanel(panel, [...boxes.rows, boxes.badge, dismiss, boxes.submit]);

	return {
		rows: boxes.rows.map((row) => relativeTo(panel, row)),
		badge: relativeTo(panel, boxes.badge),
		buttons: [dismiss, boxes.submit].map((button) => relativeTo(panel, button)),
	};
}

async function stackedDialogGeometry(page: Page): Promise<{
	panel: Box;
	parts: Box[];
	scroll: { sideways: boolean; inside: boolean };
}> {
	const panel = await measuredBox(page, PANEL);
	const boxes = await planFormBoxes(page, PANEL);
	const dismiss = await measuredBox(page, `${PANEL} ${DISMISS}`);

	rowsStackInOneColumn(boxes.rows);
	tabSitsOnFeaturedRow(boxes);
	pricesSitUnderTheirBilledLines(boxes);
	assert.ok(boxes.submit.y + boxes.submit.height <= dismiss.y, "Subscribe now must sit above Cancel");

	return {
		panel,
		parts: [...boxes.rows, boxes.badge, boxes.submit, dismiss],
		scroll: await page.locator(PANEL).evaluate((element) => ({
			sideways: element.scrollWidth !== element.clientWidth,
			inside: element.scrollHeight > element.clientHeight,
		})),
	};
}

function dialogCheckpoint(input: {
	name: string;
	geometry: (page: Page) => Promise<void>;
	pinnedText: VisualCheckpoint["pinnedText"];
}): VisualCheckpoint {
	return {
		name: input.name,
		settled: dialogOpen,
		geometry: input.geometry,
		target: PANEL,
		capture: "element",
		pinnedText: input.pinnedText,
	};
}

test.describe("Subscribe plans dialog", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("renders the same plan rows from the queue and the account page, and the plans page reuses them (light)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signInTrialingReader(page, `light-${testInfo.workerIndex}-${Date.now()}`);
		const measured: PanelRelativeBoxes[] = [];
		const measure = async (current: Page) => {
			measured.push(await desktopDialogGeometry(current));
		};

		await openPlansDialog(page, { path: "/queue", bodyClass: "page-readlist" });
		await captureCheckpoint(
			page,
			dialogCheckpoint({ name: "subscribe-plans-queue-light", geometry: measure, pinnedText: TRIAL_TILES_PINNED }),
		);
		await openPlansDialog(page, { path: "/account", bodyClass: "page-account" });
		await captureCheckpoint(
			page,
			dialogCheckpoint({ name: "subscribe-plans-account-light", geometry: measure, pinnedText: [] }),
		);
		const [fromQueue, fromAccount] = measured;
		assert.deepEqual(fromAccount, fromQueue);

		await page.goto(`${BASE_URL}/account/plans`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector("body.page-plans");
		await waitForBrandFonts(page, ["Inter"]);
		const onPage = await planFormBoxes(page, PLANS_PAGE);
		rowsStackInOneColumn(onPage.rows);
		assert.deepEqual(
			onPage.rows.map((row) => Math.round(row.width)),
			PLAN_KEYS.map(() => 600),
		);
		tabSitsOnFeaturedRow(onPage);
		pricesSitBesideTheirText(onPage);
		submitIsFlushWithTheRows(onPage);
	});

	test("renders the plan rows on the dark card (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await signInTrialingReader(page, `dark-${testInfo.workerIndex}-${Date.now()}`);

		await openPlansDialog(page, { path: "/queue", bodyClass: "page-readlist" });
		await captureCheckpoint(
			page,
			dialogCheckpoint({
				name: "subscribe-plans-queue-dark",
				geometry: async (current) => {
					await desktopDialogGeometry(current);
				},
				pinnedText: TRIAL_TILES_PINNED,
			}),
		);
	});

	test("checks the plan every no-choice path charges, moves the check to the clicked row, and closes from Cancel or Esc", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signInTrialingReader(page, `behaviour-${testInfo.workerIndex}-${Date.now()}`);
		const panel = page.locator(PANEL);

		const checkedPlan = page.locator(`${PANEL} input[name="plan"]:checked`);

		await openPlansDialog(page, { path: "/queue", bodyClass: "page-readlist" });
		await expect(checkedPlan).toHaveValue("yearly");
		await page.locator(`${PANEL} [data-test-plan="monthly"]`).click();
		await expect(checkedPlan).toHaveValue("monthly");

		await page.locator(`${PANEL} ${DISMISS}`).click();
		await expect(panel).toBeHidden();

		await page.click(OPEN_TRIGGER);
		await expect(panel).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(panel).toBeHidden();
	});
});

test.describe("Subscribe plans dialog on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 390, height: 844 } });

	test("drops each price under its billed line and stacks the commit above Cancel", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signInTrialingReader(page, `phone-${testInfo.workerIndex}-${Date.now()}`);

		await openPlansDialog(page, { path: "/queue", bodyClass: "page-readlist" });
		await captureCheckpoint(
			page,
			dialogCheckpoint({
				name: "subscribe-plans-queue-phone",
				geometry: async (current) => {
					const stacked = await stackedDialogGeometry(current);
					assert.deepEqual(stacked.scroll, { sideways: false, inside: false });
					partsSitInsidePanel(stacked.panel, stacked.parts);
				},
				pinnedText: TRIAL_TILES_PINNED,
			}),
		);
	});
});

test.describe("Subscribe plans on the narrowest phone", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 320, height: 700 } });

	test("keeps the dialog and the plans page from scrolling sideways", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signInTrialingReader(page, `narrow-${testInfo.workerIndex}-${Date.now()}`);

		await openPlansDialog(page, { path: "/queue", bodyClass: "page-readlist" });
		await dialogOpen(page);
		const stacked = await stackedDialogGeometry(page);
		assert.equal(stacked.scroll.sideways, false, "the dialog must not scroll sideways at 320px");

		await page.goto(`${BASE_URL}/account/plans`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector("body.page-plans");
		await waitForBrandFonts(page, ["Inter"]);
		pricesSitUnderTheirBilledLines(await planFormBoxes(page, PLANS_PAGE));
		assert.equal(await page.evaluate(pageOverflowsSideways), false, "the plans page must not scroll sideways at 320px");
	});
});
