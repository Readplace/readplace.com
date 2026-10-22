import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { captureCheckpoint, expect, measuredBox, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { measureScrollBox, scrollBoxTo, scrollPanelToShow } from "./gmail-newsletters-visual.browser";
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
const VOLATILE_CHROME = [".offline-banner", ".newer-version-banner", "[data-test-extension-suggestion-banner]", "[data-test-changelog-banner]"];

const DIALOG = "#gmail-dialog";
const OPEN_DIALOG = "#gmail-dialog:popover-open";
const DIALOG_FOOTER = "[data-test-gmail-dialog-footer]";
const SENDER_STATUS = "#gmail-sender-status";
const SENDER_PICKER = "[data-test-gmail-sender-picker]";
const SENDER_MENU = `${SENDER_PICKER} .gmail__picker-menu`;
const RESULTS = "[data-test-gmail-sender-results]";
const SENDER_OPTION = "[data-test-gmail-sender-option]";
const SENDER_OPTION_NAME = "[data-test-gmail-sender-option-name]";
const SEARCH = "#gmail-sender-search";
const CHECKLIST = "[data-test-gmail-checklist]";
const CHECKLIST_TOOLBAR = `${CHECKLIST} .gmail__checklist-toolbar`;
const CHECKLIST_SUMMARY = "[data-test-gmail-checklist-summary]";
const CHECKLIST_ROWS = "[data-test-gmail-checklist-rows]";
const CHECKLIST_ROW = "[data-test-gmail-checklist-row]";
const CHECKLIST_TICK = "[data-test-gmail-checklist-sender]";
const CHECKLIST_NAME = "[data-test-gmail-checklist-name]";
const SELECT_TOGGLE = '[data-test-gmail-checklist-action="select"]';
const RETRY = '[data-test-gmail-checklist-action="retry"]';
const MIN_ROW_HEIGHT = 44;

const TLDR = { email: "dan@tldr.tech", name: "TLDR" };
const BREW = { email: "crew@morningbrew.com", name: "Morning Brew" };
const POINTER = { email: "suraj@pointer.io" };
const KALE = { email: "kale@hackernewsletter.com", name: "Hacker Newsletter" };

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

type CatalogMode = "available" | "unavailable";
type Newsletter = { email: string; name?: string };

interface PickerSeed {
	catalogMode: CatalogMode;
	approved: readonly Newsletter[];
	discovered: readonly Newsletter[];
}

function digestNewsletters(count: number): Newsletter[] {
	return Array.from({ length: count }, (_, index) => {
		const issue = String(index).padStart(3, "0");
		return { email: `digest-${issue}@weekly-digests.com`, name: `Weekly Digest ${issue}` };
	});
}

async function seedCatalog(
	page: Page,
	input: { namespace: string; mode: CatalogMode; approved: readonly Newsletter[] },
): Promise<void> {
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-newsletter-catalog`, {
		data: {
			namespace: input.namespace,
			mode: input.mode,
			records: input.approved.map((newsletter) => ({
				from: newsletter.email,
				name: newsletter.name,
				status: "approved",
				evidence: [],
				createdAt: CATALOG_TIMESTAMP,
				updatedAt: CATALOG_TIMESTAMP,
			})),
		},
	});
	assert.equal(seeded.status(), 201, "the newsletter catalog seed must be accepted");
}

async function openGmail(page: Page, input: { stamp: string; seed: PickerSeed }): Promise<string> {
	const namespace = `gmail-picker-visual-${input.stamp}`;
	await page.context().addCookies([{ name: CATALOG_COOKIE, value: namespace, url: BASE_URL }]);
	await seedCatalog(page, { namespace, mode: input.seed.catalogMode, approved: input.seed.approved });
	const email = `gmail-picker-visual-${input.stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must create the reader");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
		data: { userId, discoveredSenders: input.seed.discovered },
	});
	assert.equal(seeded.status(), 201, "the Gmail seed must connect the reader's mailbox");
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	await page.goto(`${BASE_URL}/newsletters/gmail?discovery=started&add=1`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-integrations-gmail");
	await expect(page.locator("html")).toHaveAttribute("data-gmail-picker-attached", "");
	await expect(page.locator(OPEN_DIALOG)).toHaveAttribute("data-test-confirm-popover", "gmail-add");
	await statusSettled(page);
	return namespace;
}

async function statusSettled(page: Page): Promise<void> {
	await expect(page.locator(`${SENDER_STATUS}:not([hx-get])`)).toHaveCount(1);
}

async function openSenderPicker(page: Page): Promise<void> {
	const picker = page.locator(SENDER_PICKER);
	if ((await picker.getAttribute("open")) === null) await picker.locator("summary").click();
	await expect(picker).toHaveAttribute("open", "");
	await expect(page.locator(SEARCH)).toBeFocused();
}

async function pickSender(page: Page, input: { email: string; search: string }): Promise<void> {
	await expect(page.locator(SENDER_PICKER)).toHaveAttribute("open", "");
	await page.locator(SEARCH).fill(input.search);
	await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
	await page.locator(`[data-test-gmail-sender-option="${input.email}"]`).click();
	await expect(page.locator(`[data-test-gmail-checklist-group="added"] [data-test-gmail-checklist-sender="${input.email}"]`)).toBeChecked();
	await statusSettled(page);
}

async function resultsListed(page: Page, input: { state: string; options: number; named: number }): Promise<void> {
	await expect(page.locator(SENDER_PICKER)).toHaveAttribute("open", "");
	await expect(page.locator(RESULTS)).toHaveAttribute("data-results-state", input.state);
	await expect(page.locator(SENDER_OPTION)).toHaveCount(input.options);
	await expect(page.locator(`${SENDER_OPTION} ${SENDER_OPTION_NAME}`)).toHaveCount(input.named);
}

async function checklistListed(
	page: Page,
	input: { state: string; groups: Readonly<Record<string, number>>; ticked: number; named: number },
): Promise<void> {
	await expect(page.locator(CHECKLIST)).toHaveAttribute("data-checklist-state", input.state);
	const groups = page.locator("[data-test-gmail-checklist-group]");
	await expect(groups).toHaveCount(Object.keys(input.groups).length);
	for (const [group, rows] of Object.entries(input.groups)) {
		await expect(page.locator(`[data-test-gmail-checklist-group="${group}"] ${CHECKLIST_ROW}`)).toHaveCount(rows);
	}
	await expect(page.locator(`${CHECKLIST_TICK}:checked`)).toHaveCount(input.ticked);
	await expect(page.locator(`${CHECKLIST_ROW} ${CHECKLIST_NAME}`)).toHaveCount(input.named);
}

async function noSidewaysScroll(page: Page): Promise<void> {
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the Gmail page must never scroll sideways");
}

async function checklistLaidOut(page: Page): Promise<void> {
	await panelScrollsAsOneBox(page);
	const toolbar = await measuredBox(page, CHECKLIST_TOOLBAR);
	const summary = await measuredBox(page, CHECKLIST_SUMMARY);
	assert.ok(Math.abs(summary.y - toolbar.y) <= 0.5, "the selected count must share the toolbar's first row");
	assert.ok(summary.x >= toolbar.x + toolbar.width - 0.5, "the selected count must sit in the toolbar's second column");
	const rowHeights = await page.locator(`${CHECKLIST_ROW} label`).evaluateAll((labels) =>
		labels.map((label) => label.getBoundingClientRect().height),
	);
	assert.ok(rowHeights.length > 0, "the checklist must list at least one row");
	for (const height of rowHeights) {
		assert.ok(height >= MIN_ROW_HEIGHT, `every checklist row must be at least ${MIN_ROW_HEIGHT}px tall, got ${height}px`);
	}
}

async function panelScrollsAsOneBox(page: Page): Promise<void> {
	await noSidewaysScroll(page);
	const viewport = page.viewportSize();
	assert(viewport, "the popup capture must use a fixed viewport");
	const panel = await measuredBox(page, DIALOG);
	const footer = await measuredBox(page, DIALOG_FOOTER);
	assert.ok(panel.x >= 0 && panel.x + panel.width <= viewport.width, "the panel must fit the viewport sideways");
	assert.ok(panel.y >= 0 && panel.y + panel.height <= viewport.height, "the panel must fit the viewport");
	const box = await page.evaluate(measureScrollBox, DIALOG);
	assert.equal(box.overflowY, "auto", "the panel must be the box that scrolls");
	assert.ok(box.scrollWidth <= box.clientWidth, "the panel must never scroll sideways");
	assert.ok(
		footer.y >= panel.y && footer.y + footer.height <= panel.y + panel.height + 0.5,
		"Cancel and Save must stay visible at the panel bottom",
	);
}

async function menuOpensInFlowInsidePanel(page: Page): Promise<void> {
	await panelScrollsAsOneBox(page);
	const panel = await measuredBox(page, DIALOG);
	const trigger = await measuredBox(page, `${SENDER_PICKER} summary`);
	const menu = await measuredBox(page, SENDER_MENU);
	const menuBox = await page.evaluate(measureScrollBox, SENDER_MENU);
	assert.ok(menuBox.scrollHeight <= menuBox.clientHeight, "the sender menu must grow with its results instead of scrolling on its own");
	assert.ok(menu.y >= trigger.y + trigger.height, "the sender menu must open below its trigger");
	assert.ok(
		Math.abs(menu.x - trigger.x) <= 0.5 && Math.abs(menu.width - trigger.width) <= 0.5,
		"the sender menu must hang flush under its trigger",
	);
	assert.ok(menu.x >= panel.x && menu.x + menu.width <= panel.x + panel.width, "the sender menu must stay inside the panel");
}

async function captureMatrix(
	page: Page,
	input: {
		state: string;
		reveal?: string;
		settled: (page: Page) => Promise<void>;
		geometry: (page: Page) => Promise<void>;
	},
): Promise<void> {
	for (const width of WIDTHS) {
		await page.setViewportSize(width.viewport);
		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await captureCheckpoint(page, {
				name: `gmail-picker-${input.state}-${width.name}-${theme}`,
				settled: async (settling) => {
					await expect(settling.locator(OPEN_DIALOG)).toBeVisible();
					await settling.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
					await settling.mouse.move(0, 0);
					await input.settled(settling);
					if (input.reveal !== undefined) {
						await settling.evaluate(scrollPanelToShow, { panel: DIALOG, target: input.reveal, gap: 24 });
					}
				},
				geometry: input.geometry,
				target: DIALOG,
				capture: "element",
				pinnedText: [],
			});
		}
	}
	await page.setViewportSize(DESKTOP);
}

test.describe("GMail Newsletters sender picker", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("lists known newsletters unticked, selects them all, then opens the search on every unmapped sender", async ({
		page,
	}, testInfo) => {
		await openGmail(page, {
			stamp: `checklist-${testInfo.workerIndex}-${Date.now()}`,
			seed: { catalogMode: "available", approved: [TLDR, BREW, POINTER], discovered: [TLDR, BREW, POINTER, KALE] },
		});

		await captureMatrix(page, {
			state: "checklist",
			settled: async (settling) => {
				await expect(settling.locator(SENDER_PICKER)).not.toHaveAttribute("open");
				await checklistListed(settling, { state: "listed", groups: { known: 3 }, ticked: 0, named: 2 });
				await expect(settling.locator(SELECT_TOGGLE)).toHaveAttribute("value", "all");
			},
			geometry: checklistLaidOut,
		});

		await page.locator(SELECT_TOGGLE).click();
		await expect(page.locator(SELECT_TOGGLE)).toHaveAttribute("value", "none");
		await statusSettled(page);
		await captureMatrix(page, {
			state: "checklist-selected",
			settled: async (settling) => {
				await checklistListed(settling, { state: "listed", groups: { known: 3 }, ticked: 3, named: 2 });
				await expect(settling.locator(SELECT_TOGGLE)).toHaveAttribute("value", "none");
			},
			geometry: checklistLaidOut,
		});

		await openSenderPicker(page);
		await captureMatrix(page, {
			state: "open",
			reveal: SENDER_PICKER,
			settled: (settling) => resultsListed(settling, { state: "listed", options: 4, named: 3 }),
			geometry: menuOpensInFlowInsidePanel,
		});
	});

	test("finds a sender the catalog does not know, reports no matches, and adds named and unnamed senders to the checklist", async ({
		page,
	}, testInfo) => {
		await openGmail(page, {
			stamp: `search-${testInfo.workerIndex}-${Date.now()}`,
			seed: { catalogMode: "available", approved: [TLDR, BREW], discovered: [TLDR, BREW, POINTER, KALE] },
		});
		await openSenderPicker(page);

		await page.locator(SEARCH).fill("hacker");
		await captureMatrix(page, {
			state: "unknown-sender-search",
			reveal: SENDER_PICKER,
			settled: async (settling) => {
				await resultsListed(settling, { state: "listed", options: 1, named: 1 });
				await expect(settling.locator(`[data-test-gmail-sender-option="${KALE.email}"]`)).toBeVisible();
			},
			geometry: menuOpensInFlowInsidePanel,
		});

		await page.locator(SEARCH).fill("zebra");
		await captureMatrix(page, {
			state: "no-matches",
			reveal: SENDER_PICKER,
			settled: (settling) => resultsListed(settling, { state: "no-matches", options: 0, named: 0 }),
			geometry: menuOpensInFlowInsidePanel,
		});

		await page.locator(SEARCH).fill("");
		await expect(page.locator(RESULTS)).toHaveAttribute("data-results-state", "listed");
		await pickSender(page, { email: KALE.email, search: "hacker" });
		await openSenderPicker(page);
		await pickSender(page, { email: POINTER.email, search: "pointer" });
		await captureMatrix(page, {
			state: "checklist-added",
			settled: async (settling) => {
				await expect(settling.locator(SENDER_PICKER)).not.toHaveAttribute("open");
				await checklistListed(settling, { state: "listed", groups: { known: 2, added: 2 }, ticked: 2, named: 3 });
				await expect(settling.locator(`[data-test-gmail-checklist-row="${POINTER.email}"] ${CHECKLIST_NAME}`)).toHaveCount(0);
			},
			geometry: checklistLaidOut,
		});
	});

	test("scrolls a long checklist with the rest of the popup as one box, down only, with Cancel and Save in view", async ({ page }, testInfo) => {
		const digests = digestNewsletters(120);
		await openGmail(page, {
			stamp: `long-${testInfo.workerIndex}-${Date.now()}`,
			seed: { catalogMode: "available", approved: digests, discovered: digests },
		});
		await captureMatrix(page, {
			state: "checklist-long",
			settled: async (settling) => {
				await checklistListed(settling, { state: "listed", groups: { known: 120 }, ticked: 0, named: 120 });
				await settling.evaluate(scrollBoxTo, { selector: DIALOG, top: 600 });
			},
			geometry: async (measuring) => {
				await checklistLaidOut(measuring);
				const panel = await measuring.evaluate(measureScrollBox, DIALOG);
				assert.ok(panel.scrollHeight > panel.clientHeight, "120 newsletters must overflow the panel so it scrolls");
				assert.equal(
					await measuring.locator(DIALOG).evaluate((element) => element.scrollTop),
					600,
					"the panel itself must carry the checklist's scroll",
				);
				const rows = await measuring.evaluate(measureScrollBox, CHECKLIST_ROWS);
				assert.ok(rows.scrollHeight <= rows.clientHeight, "the checklist rows must grow with the list instead of scrolling on their own");
			},
		});
	});

	test("says none of the senders is a known newsletter yet and opens the search", async ({ page }, testInfo) => {
		await openGmail(page, {
			stamp: `no-known-${testInfo.workerIndex}-${Date.now()}`,
			seed: { catalogMode: "available", approved: [TLDR], discovered: [POINTER, KALE] },
		});
		await captureMatrix(page, {
			state: "checklist-no-known",
			settled: async (settling) => {
				await expect(settling.locator(SENDER_PICKER)).toHaveAttribute("open", "");
				await expect(settling.locator(SEARCH)).toBeFocused();
				await checklistListed(settling, { state: "no-known-newsletters", groups: {}, ticked: 0, named: 0 });
				await expect(settling.locator(SELECT_TOGGLE)).toHaveCount(0);
			},
			geometry: menuOpensInFlowInsidePanel,
		});
	});

	test("says no senders were discovered for a mailbox with none", async ({ page }, testInfo) => {
		await openGmail(page, {
			stamp: `undiscovered-${testInfo.workerIndex}-${Date.now()}`,
			seed: { catalogMode: "available", approved: [TLDR], discovered: [] },
		});
		await openSenderPicker(page);
		await captureMatrix(page, {
			state: "no-discovered-senders",
			settled: async (settling) => {
				await checklistListed(settling, { state: "no-discovered-senders", groups: {}, ticked: 0, named: 0 });
				await resultsListed(settling, { state: "no-discovered-senders", options: 0, named: 0 });
			},
			geometry: menuOpensInFlowInsidePanel,
		});
	});

	test("caps the search at 100 senders and asks the reader to refine it", async ({ page }, testInfo) => {
		const digests = digestNewsletters(101);
		await openGmail(page, {
			stamp: `limit-${testInfo.workerIndex}-${Date.now()}`,
			seed: { catalogMode: "available", approved: digests, discovered: digests },
		});
		await openSenderPicker(page);
		await captureMatrix(page, {
			state: "result-limit",
			settled: async (settling) => {
				await resultsListed(settling, { state: "limited", options: 100, named: 100 });
				await settling.evaluate(scrollPanelToShow, { panel: DIALOG, target: "[data-test-gmail-refine-search]", gap: 24 });
				await expect(settling.locator("[data-test-gmail-refine-search]")).toBeInViewport();
			},
			geometry: menuOpensInFlowInsidePanel,
		});
	});

	test("offers a retry when newsletter suggestions are unavailable, and recovers once the catalog answers", async ({
		page,
	}, testInfo) => {
		const namespace = await openGmail(page, {
			stamp: `unavailable-${testInfo.workerIndex}-${Date.now()}`,
			seed: { catalogMode: "unavailable", approved: [TLDR], discovered: [TLDR, KALE] },
		});
		await captureMatrix(page, {
			state: "catalog-unavailable",
			settled: async (settling) => {
				await expect(settling.locator(SENDER_PICKER)).toHaveAttribute("open", "");
				await checklistListed(settling, { state: "catalog-unavailable", groups: {}, ticked: 0, named: 0 });
				await expect(settling.locator(RETRY)).toBeVisible();
			},
			geometry: panelScrollsAsOneBox,
		});

		await seedCatalog(page, { namespace, mode: "available", approved: [TLDR] });
		await page.locator(RETRY).click();
		await expect(page.locator(CHECKLIST)).toHaveAttribute("data-checklist-state", "listed");
		await expect(page.locator(`[data-test-gmail-checklist-row="${TLDR.email}"] ${CHECKLIST_NAME}`)).toHaveCount(1);
		await expect(page.locator(OPEN_DIALOG)).toBeVisible();
	});
});
