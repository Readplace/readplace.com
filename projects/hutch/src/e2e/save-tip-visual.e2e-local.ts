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
import {
	ALIVE_COOKIE_NAME,
	ALIVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "Sup3r-Secret-Pw!";
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const IPHONE_SAFARI_USER_AGENT =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const PANEL = "#save-tip";
const ILLUSTRATION = `${PANEL} .confirm-popover__illustration`;
const TITLE = `${PANEL} .confirm-popover__title`;
const BODY = `${PANEL} .confirm-popover__body`;
const CONTINUE = `${PANEL} [data-test-action="save-tip-continue"]`;
const PROCEED = `${PANEL} [data-test-action="save-tip-proceed"]`;
const INSTALL = `${PANEL} [data-test-action="save-tip-install"]`;
const SAVE_INPUT = '[data-test-form="save-article"] input[name="url"]';
const IMPORT_INPUT = "[data-test-import-from-url-input]";

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function loginAs(page: Page, stamp: string): Promise<void> {
	const email = `save-tip-visual-${stamp}@example.com`;
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(response.status(), 201, "the e2e fixture must create the reader");
	CreatedUser.parse(await response.json());
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function openReadlistTip(page: Page, stamp: string): Promise<void> {
	await loginAs(page, stamp);
	await expect(page.locator('[data-test-form="save-article"]')).toHaveAttribute("data-save-tip", "due");
	await page.waitForLoadState("domcontentloaded");
	await page.locator(SAVE_INPUT).focus();
	await expect(page.locator(`${PANEL}:popover-open`)).toBeVisible();
}

async function openImportTip(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/import`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-import");
	await expect(page.locator('[data-test-form="import-from-url"]')).toHaveAttribute("data-save-tip", "due");
	await page.locator(IMPORT_INPUT).focus();
	await expect(page.locator(`${PANEL}:popover-open`)).toBeVisible();
}

async function openGatingTip(page: Page, stamp: string): Promise<void> {
	const source = `${BASE_URL}/e2e/fixtures/unfetchable/${stamp}`;
	await page.goto(`${BASE_URL}/view/${encodeURIComponent(source)}`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector("body.page-view");
	const save = page.locator("#view-cta-save");
	await expect(save).toHaveAttribute("data-save-tip", "due", { timeout: 180_000 });
	await save.click();
	await expect(page.locator(`${PANEL}:popover-open`)).toBeVisible();
}

async function panelSettled(page: Page): Promise<void> {
	await page.waitForSelector(`${PANEL}:popover-open`);
	await page.mouse.move(5, 5);
	await waitForBrandFonts(page, ["Inter"]);
}

async function contentRunsTopToBottom(page: Page): Promise<void> {
	const panel = await measuredBox(page, PANEL);
	const parts = [
		["illustration", await measuredBox(page, ILLUSTRATION)],
		["title", await measuredBox(page, TITLE)],
		["body", await measuredBox(page, BODY)],
	] as const;
	for (let index = 1; index < parts.length; index++) {
		const [previousName, previous] = parts[index - 1];
		const [name, part] = parts[index];
		assert.ok(part.y >= previous.y + previous.height, `${name} sits below ${previousName}`);
	}
	for (const [name, part] of parts) {
		assert.ok(part.x >= panel.x && part.x + part.width <= panel.x + panel.width, `${name} fits inside the panel`);
		assert.ok(part.y >= panel.y && part.y + part.height <= panel.y + panel.height, `${name} fits inside the panel`);
	}
}

async function desktopGeometry(page: Page, firstControl: string): Promise<void> {
	await contentRunsTopToBottom(page);
	const panel = await measuredBox(page, PANEL);
	const body = await measuredBox(page, BODY);
	const first = await measuredBox(page, firstControl);
	const install = await measuredBox(page, INSTALL);
	assert.equal(Math.round(panel.width), 600);
	assert.ok(first.y >= body.y + body.height);
	assert.ok(Math.abs(first.y - install.y) <= 1);
	assert.ok(Math.abs(install.x - (first.x + first.width + 8)) <= 1);
	const leftSlack = first.x - panel.x;
	const rightSlack = panel.x + panel.width - (install.x + install.width);
	assert.ok(Math.abs(leftSlack - rightSlack) <= 1);
	for (const control of [first, install]) {
		assert.ok(control.y + control.height <= panel.y + panel.height);
	}
}

async function phoneGeometry(page: Page): Promise<void> {
	await contentRunsTopToBottom(page);
	const panel = await measuredBox(page, PANEL);
	const body = await measuredBox(page, BODY);
	const install = await measuredBox(page, INSTALL);
	const keepPasting = await measuredBox(page, CONTINUE);
	assert.equal(Math.round(panel.width), PHONE.width - 32);
	assert.ok(install.y >= body.y + body.height);
	assert.equal(Math.round(keepPasting.y - (install.y + install.height)), 8);
	for (const control of [install, keepPasting]) {
		assert.ok(Math.abs(control.x - (panel.x + 25)) <= 1);
		assert.ok(Math.abs(control.x + control.width - (panel.x + panel.width - 25)) <= 1);
		assert.ok(control.y + control.height <= panel.y + panel.height);
	}
	const tabOrder = await page.locator(`${PANEL} [data-test-action]`).evaluateAll((controls) =>
		controls.map((control) => control.getAttribute("data-test-action")),
	);
	assert.deepEqual(tabOrder, ["save-tip-continue", "save-tip-install"]);
}

async function singleControlGeometry(page: Page): Promise<void> {
	await contentRunsTopToBottom(page);
	const panel = await measuredBox(page, PANEL);
	const body = await measuredBox(page, BODY);
	const control = await measuredBox(page, CONTINUE);
	assert.equal(Math.round(panel.width), 600);
	assert.ok(control.y >= body.y + body.height);
	assert.ok(Math.abs((control.x + control.width / 2) - (panel.x + panel.width / 2)) <= 1);
	const controls = await page.locator(`${PANEL} [data-test-action]`).evaluateAll((items) =>
		items.map((item) => item.getAttribute("data-test-action")),
	);
	assert.deepEqual(controls, ["save-tip-continue"]);
}

function checkpoint(name: string, geometry: VisualCheckpoint["geometry"]): VisualCheckpoint {
	return {
		name,
		settled: panelSettled,
		geometry,
		target: PANEL,
		capture: "element",
		pinnedText: [],
	};
}

test.describe("Save tip advisory", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of ["light", "dark"] as const) {
		test(`illustrates the install choice on the readlist (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openReadlistTip(page, `${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await captureCheckpoint(
				page,
				checkpoint(`save-tip-advisory-${theme}`, (ready) => desktopGeometry(ready, CONTINUE)),
			);
		});
	}

	test("centres one continue control for a reader with the extension", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await loginAs(page, `extension-${testInfo.workerIndex}-${Date.now()}`);
		await page.context().addCookies([{
			name: ALIVE_COOKIE_NAME,
			value: ALIVE_COOKIE_VALUE,
			path: "/",
			domain: new URL(BASE_URL).hostname,
		}]);
		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(page.locator('[data-test-form="save-article"]')).toHaveAttribute("data-save-tip", "due");
		await page.locator(SAVE_INPUT).focus();
		await captureCheckpoint(
			page,
			checkpoint("save-tip-advisory-extension-light", singleControlGeometry),
		);
	});

	test("keeps the gating save behind the install path", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openGatingTip(page, `save-tip-visual-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(
			page,
			checkpoint("save-tip-gating-light", (ready) => desktopGeometry(ready, PROCEED)),
		);
	});

	test("fits the import advice inside the panel", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openImportTip(page);
		await captureCheckpoint(
			page,
			checkpoint("save-tip-import-light", (ready) => desktopGeometry(ready, CONTINUE)),
		);
	});
});

test.describe("Save tip advisory on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE, userAgent: IPHONE_SAFARI_USER_AGENT });

	test("stacks Explore above Continue at the iPhone width", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReadlistTip(page, `phone-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, checkpoint("save-tip-advisory-phone", phoneGeometry));
	});
});

test.describe("Save tip in a short viewport", () => {
	const viewportHeight = 260;
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: viewportHeight } });

	test("keeps the import advice scrollable inside the viewport", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openImportTip(page);
		await panelSettled(page);
		const panel = await page.locator(PANEL).evaluate((element) => ({
			bounds: element.getBoundingClientRect().toJSON(),
			clientHeight: element.clientHeight,
			scrollHeight: element.scrollHeight,
		}));
		assert.ok(panel.bounds.top >= 16);
		assert.ok(panel.bounds.bottom <= viewportHeight - 16);
		assert.ok(panel.scrollHeight > panel.clientHeight);
	});
});
