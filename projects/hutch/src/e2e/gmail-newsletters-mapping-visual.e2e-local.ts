import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { captureCheckpoint, expect, measuredBox, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { fitViewportToPage } from "./fit-viewport-to-page";
import { neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CATALOG_COOKIE = "e2e_catalog_ns";
const CATALOG_TIMESTAMP = "2026-09-01T00:00:00.000Z";
const DESKTOP = { width: 1280, height: 900 };
const WIDTHS = [
	{ name: "desktop", viewport: DESKTOP },
	{ name: "mobile", viewport: { width: 390, height: 844 } },
] as const;
const THEMES = ["light", "dark"] as const;
const VOLATILE_CHROME = [".offline-banner", "[data-test-extension-suggestion-banner]", "[data-test-changelog-banner]"];

const MAIN = "main.gmail";
const SENDER_PICKER = "[data-test-gmail-sender-picker]";
const SENDER_CHOICE = "#gmail-sender-choice";
const READLIST_PICKER = "[data-test-gmail-readlist-picker]";
const READLIST_MENU = `${READLIST_PICKER} .gmail__picker-menu`;
const READLIST_OPTION = "[data-test-gmail-readlist-option]";
const CREATE_READLIST = "[data-test-gmail-readlist-create]";
const CREATE_NAME = `${CREATE_READLIST} input[name="readlist_name"]`;
const CREATE_SUBMIT = `${CREATE_READLIST} button[type="submit"]`;
const SAVE_FORM = "[data-test-gmail-save-mapping]";
const SAVE = "[data-test-gmail-save]";
const IMPORT_CHECKBOX = `${SAVE_FORM} input[name="import"]`;
const MAPPING_ROW = "[data-test-gmail-mapping-row]";

const TLDR = { email: "dan@tldr.tech", name: "TLDR" };
const BREW = { email: "crew@morningbrew.com", name: "Morning Brew" };

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

type SeedMapping =
	| { destination: "readlist" | "disabled"; email: string; readlist: string }
	| { destination: "missing"; email: string };

interface MappingSeed {
	readlists: readonly string[];
	mappings: readonly SeedMapping[];
}

async function openGmail(page: Page, input: { stamp: string; seed: MappingSeed }): Promise<void> {
	const namespace = `gmail-mapping-visual-${input.stamp}`;
	await page.context().addCookies([{ name: CATALOG_COOKIE, value: namespace, url: BASE_URL }]);
	const catalog = await page.request.post(`${BASE_URL}/e2e/seed-newsletter-catalog`, {
		data: {
			namespace,
			records: [TLDR, BREW].map((newsletter) => ({
				from: newsletter.email,
				name: newsletter.name,
				status: "approved",
				evidence: [],
				createdAt: CATALOG_TIMESTAMP,
				updatedAt: CATALOG_TIMESTAMP,
			})),
		},
	});
	assert.equal(catalog.status(), 201, "the newsletter catalog seed must be accepted");
	const email = `gmail-mapping-visual-${input.stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must create the reader");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
		data: {
			userId,
			discoveredSenders: [TLDR, BREW],
			readlists: input.seed.readlists,
			mappings: input.seed.mappings,
		},
	});
	assert.equal(seeded.status(), 201, "the Gmail seed must connect the reader's mailbox");
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	await gotoGmail(page);
	await expect(page.locator(MAPPING_ROW)).toHaveCount(input.seed.mappings.length);
}

async function gotoGmail(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/newsletters/gmail?discovery=started`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-integrations-gmail");
	await expect(page.locator("html")).toHaveAttribute("data-gmail-picker-attached", "");
}

async function createReadlistsInOrder(page: Page, names: readonly string[]): Promise<void> {
	for (const name of names) {
		const created = await page.request.post(`${BASE_URL}/newsletters/gmail/readlists/create`, {
			form: { readlist_name: name },
		});
		assert.equal(created.status(), 200, `creating readlist "${name}" must land back on the Gmail page`);
	}
}

async function chooseSender(page: Page, email: string): Promise<void> {
	await page.locator(`${SENDER_PICKER} summary`).click();
	await expect(page.locator(SENDER_PICKER)).toHaveAttribute("open", "");
	await page.locator(`[data-test-gmail-sender-option="${email}"]`).click();
	await expect(page.locator(SENDER_CHOICE)).toContainText(email);
	await expect(page.locator(READLIST_PICKER)).toBeVisible();
}

async function openReadlistPicker(page: Page): Promise<void> {
	await page.locator(`${READLIST_PICKER} summary`).click();
	await expect(page.locator(READLIST_PICKER)).toHaveAttribute("open", "");
}

async function createReadlist(page: Page, input: { name: string; alert: string }): Promise<void> {
	await page.locator(CREATE_NAME).fill(input.name);
	await page.locator(CREATE_SUBMIT).click();
	await expect(page.locator(`[data-test-alert="${input.alert}"]`)).toBeVisible();
}

function mappingRow(page: Page, sender: string) {
	return page.locator(`[data-test-gmail-mapping-row="${sender}"]`);
}

async function readlistPickerOpen(page: Page, input: { options: number }): Promise<void> {
	await expect(page.locator(READLIST_PICKER)).toHaveAttribute("open", "");
	await expect(page.locator(READLIST_OPTION)).toHaveCount(input.options);
}

async function readlistChosen(page: Page): Promise<void> {
	await expect(page.locator(READLIST_PICKER)).not.toHaveAttribute("open");
	await expect(page.locator(`${READLIST_OPTION}[aria-current="true"]`)).toHaveCount(1);
	await expect(page.locator(SAVE)).toBeEnabled();
}

async function noSidewaysScroll(page: Page): Promise<void> {
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the Gmail page must never scroll sideways");
}

async function readlistMenuFitsInsidePage(page: Page): Promise<void> {
	await noSidewaysScroll(page);
	const main = await measuredBox(page, MAIN);
	const trigger = await measuredBox(page, `${READLIST_PICKER} summary`);
	const menu = await measuredBox(page, READLIST_MENU);
	assert.ok(menu.y >= trigger.y + trigger.height, "the readlist menu must open below its trigger");
	assert.ok(
		Math.abs(menu.x - trigger.x) <= 0.5 && Math.abs(menu.width - trigger.width) <= 0.5,
		"the readlist menu must hang flush under its trigger",
	);
	assert.ok(menu.y + menu.height <= main.y + main.height, "the readlist menu must stay inside the captured page body");
}

async function mappingRowsStayInsideTheirList(page: Page): Promise<void> {
	await noSidewaysScroll(page);
	const list = await measuredBox(page, ".gmail-mappings__list");
	for (const row of await page.locator(MAPPING_ROW).all()) {
		const box = await row.boundingBox();
		assert.ok(box, "a mapping row must be laid out");
		assert.ok(
			box.x >= list.x - 0.5 && box.x + box.width <= list.x + list.width + 0.5,
			"a mapping row must stay inside the mappings list",
		);
	}
}

async function captureMatrix(
	page: Page,
	input: { state: string; settled: (page: Page) => Promise<void>; geometry: (page: Page) => Promise<void> },
): Promise<void> {
	for (const width of WIDTHS) {
		await fitViewportToPage(page, width.viewport);
		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await captureCheckpoint(page, {
				name: `gmail-mapping-${input.state}-${width.name}-${theme}`,
				settled: async (settling) => {
					await settling.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
					await settling.mouse.move(0, 0);
					await input.settled(settling);
				},
				geometry: input.geometry,
				target: MAIN,
				capture: "element",
				pinnedText: [],
			});
		}
	}
	await page.setViewportSize(DESKTOP);
}

test.describe("GMail Newsletters mapping", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("chooses a readlist, validates, reuses and creates readlists inline, then saves the mapping", async ({
		page,
	}, testInfo) => {
		await openGmail(page, {
			stamp: `save-${testInfo.workerIndex}-${Date.now()}`,
			seed: { readlists: ["Tech"], mappings: [] },
		});
		await chooseSender(page, TLDR.email);
		await openReadlistPicker(page);
		await expect(page.locator(CREATE_NAME)).toBeFocused();
		await captureMatrix(page, {
			state: "destination-open",
			settled: (settling) => readlistPickerOpen(settling, { options: 2 }),
			geometry: readlistMenuFitsInsidePage,
		});

		await createReadlist(page, { name: "   ", alert: "readlist_name_invalid" });
		await captureMatrix(page, {
			state: "validation",
			settled: async (settling) => {
				await readlistPickerOpen(settling, { options: 2 });
				await expect(settling.locator('[data-test-alert="readlist_name_invalid"]')).toBeVisible();
				await expect(settling.locator(SENDER_CHOICE)).toContainText(TLDR.email);
			},
			geometry: readlistMenuFitsInsidePage,
		});

		await createReadlist(page, { name: "Tech", alert: "readlist_reused" });
		await captureMatrix(page, {
			state: "duplicate-name-reuse",
			settled: async (settling) => {
				await readlistChosen(settling);
				await expect(settling.locator('[data-test-alert="readlist_reused"]')).toBeVisible();
				await expect(settling.locator(READLIST_OPTION)).toHaveCount(2);
			},
			geometry: noSidewaysScroll,
		});

		await openReadlistPicker(page);
		await page.locator(CREATE_NAME).fill("Science");
		await captureMatrix(page, {
			state: "inline-create",
			settled: async (settling) => {
				await readlistPickerOpen(settling, { options: 2 });
				await expect(settling.locator(CREATE_NAME)).toHaveValue("Science");
				await expect(settling.locator(CREATE_NAME)).toBeFocused();
			},
			geometry: readlistMenuFitsInsidePage,
		});

		await page.locator(CREATE_SUBMIT).click();
		await expect(page.locator('[data-test-alert="readlist_created"]')).toBeVisible();
		await captureMatrix(page, {
			state: "readlist-created",
			settled: async (settling) => {
				await readlistChosen(settling);
				await expect(settling.locator('[data-test-alert="readlist_created"]')).toBeVisible();
				await expect(settling.locator(READLIST_OPTION)).toHaveCount(3);
			},
			geometry: noSidewaysScroll,
		});

		await openReadlistPicker(page);
		await page.locator('[data-test-gmail-readlist-option="default"]').click();
		await expect(page.locator('[data-test-gmail-readlist-option="default"]')).toHaveAttribute("aria-current", "true");
		await captureMatrix(page, {
			state: "destination-selected",
			settled: async (settling) => {
				await readlistChosen(settling);
				await expect(settling.locator('[data-test-alert="readlist_created"]')).toHaveCount(0);
				await expect(settling.locator(IMPORT_CHECKBOX)).not.toBeChecked();
			},
			geometry: noSidewaysScroll,
		});

		let releaseSave: (() => void) | undefined;
		const saveHeld = new Promise<void>((resolve) => {
			releaseSave = resolve;
		});
		await page.route("**/newsletters/gmail/senders/add**", async (route) => {
			await saveHeld;
			await route.continue();
		});
		await page.locator(SAVE).click();
		await captureMatrix(page, {
			state: "submitting",
			settled: async (settling) => {
				await expect(settling.locator(SAVE_FORM)).toHaveClass(/htmx-request/);
				await expect(settling.locator(SAVE)).toBeDisabled();
				await expect(settling.locator(`${SAVE} .gmail__submit-loader`)).toBeVisible();
			},
			geometry: noSidewaysScroll,
		});
		assert(releaseSave, "the held save must be releasable");
		releaseSave();

		await expect(page.locator('[data-test-alert="sender_mapped"]')).toBeVisible();
		await captureMatrix(page, {
			state: "success",
			settled: async (settling) => {
				await expect(settling.locator('[data-test-alert="sender_mapped"]')).toBeVisible();
				await expect(settling.locator(MAPPING_ROW)).toHaveCount(1);
				await expect(
					mappingRow(settling, TLDR.email).locator("[data-test-gmail-mapping-destination]"),
				).toHaveAttribute("data-destination-kind", "readlist");
				await expect(settling.locator(READLIST_PICKER)).toHaveCount(0);
			},
			geometry: mappingRowsStayInsideTheirList,
		});
	});

	test("keeps every existing readlist selectable but offers no new one at the seven-readlist cap", async ({
		page,
	}, testInfo) => {
		const shelves = ["Tech", "Science", "Design", "Business", "Culture", "Health", "Travel"];
		await openGmail(page, {
			stamp: `cap-${testInfo.workerIndex}-${Date.now()}`,
			seed: { readlists: [], mappings: [] },
		});
		await createReadlistsInOrder(page, shelves);
		await gotoGmail(page);
		await chooseSender(page, BREW.email);
		await openReadlistPicker(page);
		await captureMatrix(page, {
			state: "readlist-cap",
			settled: async (settling) => {
				await readlistPickerOpen(settling, { options: 8 });
				await expect(settling.locator(`${READLIST_OPTION}:not([data-test-gmail-readlist-option="default"])`)).toHaveText(shelves);
				await expect(settling.locator("[data-test-gmail-readlist-limit]")).toBeVisible();
				await expect(settling.locator(CREATE_READLIST)).toHaveCount(0);
			},
			geometry: readlistMenuFitsInsidePage,
		});
	});

	test("moves a mapped newsletter to another readlist, then removes a mapping", async ({ page }, testInfo) => {
		await openGmail(page, {
			stamp: `remap-${testInfo.workerIndex}-${Date.now()}`,
			seed: {
				readlists: ["Tech"],
				mappings: [
					{ destination: "readlist", email: TLDR.email, readlist: "Tech" },
					{ destination: "readlist", email: BREW.email, readlist: "All" },
				],
			},
		});
		await captureMatrix(page, {
			state: "mapped",
			settled: async (settling) => {
				await expect(settling.locator(MAPPING_ROW)).toHaveCount(2);
				await expect(settling.locator('[data-destination-kind="readlist"]')).toHaveCount(2);
			},
			geometry: mappingRowsStayInsideTheirList,
		});

		await mappingRow(page, TLDR.email).locator('[data-test-gmail-mapping-action="edit"]').click();
		await expect(page.locator(READLIST_PICKER)).toHaveAttribute("open", "");
		await captureMatrix(page, {
			state: "remap",
			settled: async (settling) => {
				await readlistPickerOpen(settling, { options: 2 });
				await expect(settling.locator(SENDER_CHOICE)).toContainText(TLDR.email);
				await expect(settling.locator(`${READLIST_OPTION}[aria-current="true"]`)).toHaveCount(1);
				await expect(settling.locator(IMPORT_CHECKBOX)).toHaveCount(0);
			},
			geometry: readlistMenuFitsInsidePage,
		});

		await page.locator('[data-test-gmail-readlist-option="default"]').click();
		await expect(page.locator('[data-test-gmail-readlist-option="default"]')).toHaveAttribute("aria-current", "true");
		await expect(page.locator(READLIST_PICKER)).not.toHaveAttribute("open");
		await page.locator(SAVE).click();
		await expect(page.locator('[data-test-alert="sender_remapped"]')).toBeVisible();
		await captureMatrix(page, {
			state: "remapped",
			settled: async (settling) => {
				await expect(settling.locator('[data-test-alert="sender_remapped"]')).toBeVisible();
				await expect(settling.locator(MAPPING_ROW)).toHaveCount(2);
			},
			geometry: mappingRowsStayInsideTheirList,
		});

		await mappingRow(page, BREW.email).locator('[data-test-gmail-mapping-action="remove"]').click();
		await expect(page.locator('[data-test-alert="sender_removed"]')).toBeVisible();
		await captureMatrix(page, {
			state: "removal",
			settled: async (settling) => {
				await expect(settling.locator('[data-test-alert="sender_removed"]')).toBeVisible();
				await expect(settling.locator(MAPPING_ROW)).toHaveCount(1);
			},
			geometry: mappingRowsStayInsideTheirList,
		});
	});

	test("asks for a readlist when a mapping's destination is missing or switched off", async ({ page }, testInfo) => {
		await openGmail(page, {
			stamp: `unresolved-${testInfo.workerIndex}-${Date.now()}`,
			seed: {
				readlists: ["Tech"],
				mappings: [
					{ destination: "missing", email: TLDR.email },
					{ destination: "disabled", email: BREW.email, readlist: "Tech" },
				],
			},
		});
		await captureMatrix(page, {
			state: "unresolved-destination",
			settled: async (settling) => {
				await expect(settling.locator(MAPPING_ROW)).toHaveCount(2);
				await expect(settling.locator('[data-destination-kind="unresolved"]')).toHaveCount(2);
			},
			geometry: mappingRowsStayInsideTheirList,
		});

		await mappingRow(page, TLDR.email).locator('[data-test-gmail-mapping-action="edit"]').click();
		await expect(page.locator(READLIST_PICKER)).toHaveAttribute("open", "");
		await captureMatrix(page, {
			state: "unresolved-choose",
			settled: async (settling) => {
				await readlistPickerOpen(settling, { options: 2 });
				await expect(settling.locator(`${READLIST_OPTION}[aria-current="true"]`)).toHaveCount(0);
				await expect(settling.locator(`${SAVE_FORM} button[type="submit"]`)).toBeDisabled();
			},
			geometry: readlistMenuFitsInsidePage,
		});

		await page.locator('[data-test-gmail-readlist-option="default"]').click();
		await page.locator(SAVE).click();
		await expect(page.locator('[data-test-alert="sender_remapped"]')).toBeVisible();
		await expect(mappingRow(page, TLDR.email).locator("[data-test-gmail-mapping-destination]")).toHaveAttribute(
			"data-destination-kind",
			"readlist",
		);
	});
});
