import assert from "node:assert/strict";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	expect,
	measuredBox,
	snapToWholePixels,
	test,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { ALIVE_COOKIE_NAME, ALIVE_COOKIE_VALUE, SAVE_COOKIE_NAME, SAVE_COOKIE_VALUE } from "@packages/onboarding-extension-signal";
import { encodeImportSkippedCookie, IMPORT_SKIPPED_COOKIE_NAME } from "../runtime/web/pages/import/import-skipped-cookie";
import {
	clickAndWaitForPageReload,
	fileArticleIntoReadlist,
	nameNewReadlist,
	openReadlistSwitcher,
	renameableSlugs,
} from "./page-interactions";
import { neutraliseVolatileChrome } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "Sup3r-Secret-Pw!";

const EINK_VIEWPORT = { width: 758, height: 1024 };

const CONTRAST_SENSITIVE = {
	stylePath: join(__dirname, "eink-greyscale.css"),
	threshold: 0.02,
} as const;

const READER_ROOT = "main.reader";
const READLIST_LIST = "[data-test-article-list]";
const READLIST_TABS = "[data-test-filters]";
const READLIST_RAIL = ".readlist__rail";
const READLIST_SAVE_CARD = "[data-test-save-card]";
const SETUP_GUIDE = "[data-test-setup-guide]";
const READLIST_LAYOUT = ".readlist__layout";
const READLIST_PREFERENCES = "[data-test-readlist-preferences]";
const OPEN_FILTER_DRAWER = "[data-test-discovery-drawer]:popover-open";
const FETCHED_AT = "2026-04-27T08:00:00.000Z";

const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
	".crawl-bookmark",
	".reader__float-stack",
	".article-body__progress",
];
const PINNED_SAVED_TIMES = ["2 days ago", "3 days ago", "4 days ago"];

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ ok: z.literal(true), articleId: z.string() });

const READER_BODY = [
	"<p>An e-ink panel renders sixteen shades of grey and cannot animate, so anything that carries meaning through hue alone disappears the moment the page reaches the screen.</p>",
	'<p>The reference is the <a href="https://www.w3.org/TR/WCAG22/#contrast-minimum">WCAG 2.2 contrast minimum</a>, which asks for 4.5:1 on body text, and <a href="https://www.w3.org/TR/WCAG22/#use-of-color">use of colour</a> for the case where hue is the only cue.</p>',
	"<p>Every page here renders on the server and every interaction is a plain form, so what is left for the panel is legibility.</p>",
].join("");

const READLIST_ARTICLES = [
	{
		slug: "eink-greyscale-second",
		title: "The second article in the readlist",
		savedAt: "2026-07-11T09:14:00.000Z",
		excerpt: "A fixed excerpt, long enough to occupy the two lines a real card excerpt occupies.",
		topics: ["Productivity", "Focus", "Lifestyle"],
	},
	{
		slug: "eink-greyscale-third",
		title: "Sixteen greys and the death of the colour cue",
		savedAt: "2026-07-10T09:14:00.000Z",
		excerpt: "A second fixed excerpt so the listing shows more than a single card.",
	},
];

async function createEinkUser(page: Page, stamp: string): Promise<{ email: string; userId: string }> {
	const email = `eink-greyscale-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must create the owner");
	const { userId } = CreatedUser.parse(await created.json());
	return { email, userId };
}

async function seedReaderAndReadlist(page: Page, stamp: string): Promise<{ email: string; readerUrl: string; articleId: string }> {
	const { email, userId } = await createEinkUser(page, stamp);

	for (const article of READLIST_ARTICLES) {
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/${article.slug}`,
				title: article.title,
				content: "<p>Seeded body for the greyscale readlist baseline.</p>",
				contentFetchedAt: FETCHED_AT,
				savedAt: article.savedAt,
				savedByUserId: userId,
				excerpt: article.excerpt,
				generatedSummary: { summary: "Seeded summary.", excerpt: article.excerpt, topics: article.topics },
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the readlist article");
	}

	const reader = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: "https://example.com/eink-greyscale-reader",
			title: "Reading Readplace on an e-ink screen",
			content: READER_BODY,
			contentFetchedAt: FETCHED_AT,
			savedAt: "2026-07-12T09:14:00.000Z",
			savedByUserId: userId,
			excerpt: "Sixteen greys, no animation, and a browser that may not run JavaScript.",
			generatedSummary: {
				summary: "A fixed summary so the panel is baselined in one state.",
				excerpt: "A fixed summary so the panel is baselined in one state.",
			},
		},
	});
	assert.equal(reader.status(), 201, "the seed endpoint must create the reader article");
	const { articleId } = SeededArticle.parse(await reader.json());

	return { email, readerUrl: `${BASE_URL}/queue/${articleId}/view`, articleId };
}

/** Omitting generatedSummary leaves the row's summary pending, which is the one
 * state that renders the animated ellipsis. */
async function seedPendingSummary(
	page: Page,
	stamp: string,
): Promise<{ email: string; readerUrl: string }> {
	const { email, userId } = await createEinkUser(page, stamp);

	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/eink-greyscale-${stamp}`,
			title: "A summary that has not landed yet",
			content: READER_BODY,
			contentFetchedAt: FETCHED_AT,
			savedAt: "2026-07-12T09:14:00.000Z",
			savedByUserId: userId,
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the reader article");
	const { articleId } = SeededArticle.parse(await seeded.json());

	return { email, readerUrl: `${BASE_URL}/queue/${articleId}/view` };
}

async function createReadlist(page: Page, label: string): Promise<string> {
	const created = await page.request.post(`${BASE_URL}/queue/queues`, { form: { label } });
	assert.equal(created.status(), 200, "a readlist under the cap must be created and landed on");
	const slug = new URL(created.url()).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function settle(page: Page, target: string): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await page.evaluate(neutraliseVolatileChrome, {
		volatile: VOLATILE_CHROME,
		times: PINNED_SAVED_TIMES,
	});
	await page.mouse.move(0, 0);
	let previous = "";
	await expect
		.poll(async () => {
			const box = await page.locator(target).boundingBox();
			const current = JSON.stringify(box);
			const stable = current === previous;
			previous = current;
			return stable;
		})
		.toBe(true);
	await snapToWholePixels(page, target);
}

test.describe("Readplace holds its ink when the screen has only greys", () => {
	test.use({ timezoneId: "UTC", viewport: EINK_VIEWPORT });

	for (const theme of ["light", "dark"] as const) {
		test(`the setup guide keeps its contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email, userId } = await createEinkUser(page, `setup-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			const subscription = await page.request.post(`${BASE_URL}/e2e/seed-subscription-state`, {
				data: { userId, state: "trialing" },
			});
			assert.equal(subscription.status(), 201);
			await loginAs(page, email);
			await page.context().addCookies([
				{ name: ALIVE_COOKIE_NAME, value: ALIVE_COOKIE_VALUE, url: BASE_URL },
				{ name: SAVE_COOKIE_NAME, value: SAVE_COOKIE_VALUE, url: BASE_URL },
			]);
			await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
			await expect(page.locator('[data-test-onboarding-progress="50"]')).toBeVisible();
			await expect(page.locator(".setup-guide__marker--complete")).toHaveCount(2);
			await expect(page.locator(".setup-guide__marker--current")).toHaveCount(1);
			await expect(page.locator(".setup-guide__marker--upcoming")).toHaveCount(1);
			await settle(page, SETUP_GUIDE);
			await expect(page.locator(SETUP_GUIDE)).toHaveScreenshot(`eink-setup-guide-${theme}.png`, CONTRAST_SENSITIVE);
		});

		test(`the setup guide's pie stays distinct in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email, userId } = await createEinkUser(page, `setup-pie-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			const subscription = await page.request.post(`${BASE_URL}/e2e/seed-subscription-state`, {
				data: { userId, state: "trialing" },
			});
			assert.equal(subscription.status(), 201);
			const inbox = await page.request.post(`${BASE_URL}/e2e/seed-inbox-article-queued`, { data: { userId } });
			assert.equal(inbox.status(), 201);
			for (let index = 0; index < 4; index += 1) {
				const article = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
					data: {
						url: `https://example.com/eink-setup-${email}-${index}`,
						title: `Saved article ${index + 1}`,
						content: "<p>An article for the greyscale milestone capture.</p>",
						contentFetchedAt: FETCHED_AT,
						savedAt: "2026-07-12T09:14:00.000Z",
						savedByUserId: userId,
					},
				});
				assert.equal(article.status(), 201);
			}
			await loginAs(page, email);
			await page.context().addCookies([
				{ name: ALIVE_COOKIE_NAME, value: ALIVE_COOKIE_VALUE, url: BASE_URL },
				{ name: SAVE_COOKIE_NAME, value: SAVE_COOKIE_VALUE, url: BASE_URL },
			]);
			await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
			await expect(page.locator('[data-test-onboarding-progress="75"]')).toBeVisible();
			await expect(page.locator("[data-test-onboarding-chip]")).toHaveText("Saved 4 of 50");
			await expect(page.locator(".setup-guide__marker--complete")).toHaveCount(3);
			await expect(page.locator(".setup-guide__marker--partial-1")).toHaveCount(1);
			await settle(page, SETUP_GUIDE);
			await expect(page.locator(SETUP_GUIDE)).toHaveScreenshot(`eink-setup-guide-next-read-${theme}.png`, CONTRAST_SENSITIVE);
		});

		test(`the reader keeps its contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email, readerUrl } = await seedReaderAndReadlist(
				page,
				`reader-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await page.goto(readerUrl, { waitUntil: "domcontentloaded" });
			await page.waitForSelector('[data-test-reader-slot][data-reader-status="ready"]');
			await settle(page, READER_ROOT);

			await expect(page.locator(READER_ROOT)).toHaveScreenshot(
				`eink-reader-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the readlist keeps its contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email } = await seedReaderAndReadlist(
				page,
				`readlist-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await expect(page.locator("[data-test-article]")).toHaveCount(READLIST_ARTICLES.length + 1);
			await expect(page.locator('[data-card-status="pending"]')).toHaveCount(0);
			await settle(page, READLIST_LIST);

			await expect(page.locator(READLIST_LIST)).toHaveScreenshot(
				`eink-readlist-${theme}.png`,
				CONTRAST_SENSITIVE,
			);

			await expect(page.locator("#readlist-count")).toHaveText(
				`${READLIST_ARTICLES.length + 1} Saved Articles`,
			);
			await expect(page.locator('[data-test-filter="unread"]')).toHaveText("To Read");
			await settle(page, READLIST_TABS);
			await expect(page.locator(READLIST_TABS)).toHaveScreenshot(
				`eink-readlist-tabs-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the filter drawer keeps its selected chips in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email } = await seedReaderAndReadlist(
				page,
				`filter-drawer-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await page.goto(`${BASE_URL}/queue?time=under-5&saved=today&topic=Focus`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("[data-test-article]")).toHaveCount(1);
			await page.locator('[data-test-action="open-discovery-filters"]').click();
			const drawer = page.locator(OPEN_FILTER_DRAWER);
			await expect(drawer).toBeVisible();
			await expect(drawer.locator("input:checked")).toHaveCount(3);
			await settle(page, OPEN_FILTER_DRAWER);

			const box = await measuredBox(page, OPEN_FILTER_DRAWER);
			assert.equal(Math.round(box.width), 600);
			await expect(drawer).toHaveScreenshot(
				`eink-readlist-filter-drawer-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the save card keeps its contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email } = await createEinkUser(
				page,
				`readlist-save-card-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await page.context().addCookies([{
				name: IMPORT_SKIPPED_COOKIE_NAME,
				value: encodeImportSkippedCookie([
					{ code: "unsupported_scheme", url: "chrome://extensions/" },
					{ code: "private_network", url: "http://192.168.1.10/admin" },
					{ code: "malformed_url", url: "invalid-link-".padEnd(150, "x") },
				]),
				domain: new URL(BASE_URL).hostname,
				path: "/queue",
			}]);
			const counts = page.waitForResponse((response) => response.url().includes("/queue/counts"));
			await page.goto(`${BASE_URL}/queue?import_imported=42&import_total=50&import_skipped=3`, {
				waitUntil: "domcontentloaded",
			});
			await counts;
			await expect(page.locator("[data-test-import-flash]")).toHaveText("42 of 50 links imported. 3 couldn't be imported.");
			await expect(page.locator("[data-test-import-skipped-row]")).toHaveCount(3);
			await settle(page, READLIST_SAVE_CARD);

			await expect(page.locator(READLIST_SAVE_CARD)).toHaveScreenshot(
				`eink-readlist-save-card-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the open card menu keeps its edge in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email } = await seedReaderAndReadlist(
				page,
				`readlist-menu-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await expect(page.locator("[data-test-article]")).toHaveCount(READLIST_ARTICLES.length + 1);
			await expect(page.locator('[data-card-status="pending"]')).toHaveCount(0);
			const card = page.locator("[data-test-article]").first();
			await card.locator('[data-test-action="article-menu"]').click();
			await expect(card.locator(".menu__panel")).toBeVisible();
			await settle(page, READLIST_LIST);

			await expect(page.locator(READLIST_LIST)).toHaveScreenshot(
				`eink-readlist-menu-open-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the open readlist switcher keeps its selected row in greyscale (${theme})`, async ({
			page,
		}, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email } = await seedReaderAndReadlist(
				page,
				`readlist-switcher-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await openReadlistSwitcher(page);
			await clickAndWaitForPageReload(page, await nameNewReadlist(page, "New Readlist"));
			await openReadlistSwitcher(page);
			await clickAndWaitForPageReload(page, page.locator('main [data-test-readlist="default"]'));
			await expect(page.locator('main [data-test-readlist="default"]')).toHaveAttribute("aria-current", "page");
			await openReadlistSwitcher(page);
			await settle(page, READLIST_RAIL);

			await expect(page.locator(READLIST_RAIL)).toHaveScreenshot(
				`eink-readlist-switcher-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the save tip keeps its contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email } = await seedReaderAndReadlist(
				page,
				`save-tip-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await expect(page.locator('[data-test-form="save-article"]')).toHaveAttribute("data-save-tip", "due");
			await page.waitForLoadState("domcontentloaded");
			await page.locator('[data-test-form="save-article"] input[name="url"]').focus();
			const panel = page.locator('#save-tip:popover-open');
			await expect(panel).toBeVisible();
			await settle(page, '#save-tip:popover-open');

			await expect(panel).toHaveScreenshot(
				`eink-save-tip-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the article delete dialog keeps its contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email } = await seedReaderAndReadlist(
				page,
				`delete-dialog-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			const card = page.locator("[data-test-article]").first();
			await card.locator('[data-test-action="article-menu"]').click();
			await card.locator('[data-test-action="delete"]').click();
			const panel = page.locator('[data-test-confirm-popover="delete"]:popover-open');
			await expect(panel).toBeVisible();
			await settle(page, '[data-test-confirm-popover="delete"]:popover-open');

			const box = await measuredBox(page, '[data-test-confirm-popover="delete"]:popover-open');
			assert.equal(Math.round(box.width), 600);
			await expect(panel).toHaveScreenshot(
				`eink-delete-article-dialog-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the move dialog keeps its selected row in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email, articleId } = await seedReaderAndReadlist(
				page,
				`move-dialog-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await createReadlist(page, "Ideas & Inspiration");
			await createReadlist(page, "Finance");
			const weekend = await createReadlist(page, "Weekend");
			const filed = await page.request.post(`${BASE_URL}/queue/${articleId}/assign`, {
				form: { queue: weekend, returnTo: "/queue" },
			});
			assert.equal(filed.status(), 200, "filing the article into a readlist must land back on the listing");
			await page.goto(`${BASE_URL}/queue?queue=${weekend}`, { waitUntil: "domcontentloaded" });
			const card = page.locator(`[data-test-article="${articleId}"]`);
			await card.locator('[data-test-action="article-menu"]').click();
			await card.locator('[data-test-action="move"]').click();
			const panel = page.locator('[data-test-confirm-popover="move"]:popover-open');
			await expect(panel).toBeVisible();
			await panel.locator("[data-test-move-destination]").first().click();
			await expect(panel.locator('input[name="to"]').first()).toBeChecked();
			await settle(page, '[data-test-confirm-popover="move"]:popover-open');

			const box = await measuredBox(page, '[data-test-confirm-popover="move"]:popover-open');
			assert.equal(Math.round(box.width), 600);
			await expect(panel).toHaveScreenshot(
				`eink-readlist-move-dialog-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the move-or-delete dialog keeps its contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email, articleId } = await seedReaderAndReadlist(
				page,
				`move-or-delete-dialog-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await openReadlistSwitcher(page);
			await clickAndWaitForPageReload(page, await nameNewReadlist(page, "Ideas & Inspiration"));
			await openReadlistSwitcher(page);
			await clickAndWaitForPageReload(page, await nameNewReadlist(page, "Finance"));
			await expect(page.locator(`${READLIST_RAIL} [data-test-readlist]`)).toHaveCount(3);
			const [first] = await renameableSlugs(page);
			await fileArticleIntoReadlist(page, { articleId, readlistSlug: first });
			await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
			await openReadlistSwitcher(page);
			const menu = page.locator(`[data-test-readlist-menu="${first}"]`);
			await menu.locator('[data-test-action="readlist-menu"]').click();
			await menu.locator('[data-test-action="readlist-delete"]').click();
			const panel = page.locator('[data-test-confirm-popover="readlist-delete"]:popover-open');
			await expect(panel).toBeVisible();
			await settle(page, '[data-test-confirm-popover="readlist-delete"]:popover-open');

			const box = await measuredBox(page, '[data-test-confirm-popover="readlist-delete"]:popover-open');
			assert.equal(Math.round(box.width), 600);
			await expect(panel).toHaveScreenshot(
				`eink-readlist-delete-migrate-dialog-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the subscribe plans dialog keeps its contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email, userId } = await createEinkUser(
				page,
				`subscribe-plans-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			const subscription = await page.request.post(`${BASE_URL}/e2e/seed-subscription-state`, {
				data: { userId, state: "trialing" },
			});
			assert.equal(subscription.status(), 201);
			await loginAs(page, email);
			await page.click('[data-test-action="subscribe-plans-open"]');
			const panel = page.locator('[data-test-confirm-popover="subscribe-plans"]:popover-open');
			await expect(panel).toBeVisible();
			await settle(page, '[data-test-confirm-popover="subscribe-plans"]:popover-open');

			const box = await measuredBox(page, '[data-test-confirm-popover="subscribe-plans"]:popover-open');
			assert.equal(Math.round(box.width), 600);
			await expect(panel).toHaveScreenshot(
				`eink-subscribe-plans-dialog-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the status toast keeps its contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email, articleId } = await seedReaderAndReadlist(
				page,
				`status-toast-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await page.route("**/client-dist/toast.client.js", (route) => route.abort());
			const counts = page.waitForResponse((response) => response.url().includes("/queue/counts"));
			await page.goto(`${BASE_URL}/queue?status_changed=read&status_article=${encodeURIComponent(articleId)}`, {
				waitUntil: "domcontentloaded",
			});
			await counts;
			await expect(page.locator("[data-test-toast-message]")).toHaveText("Marked as read");
			await settle(page, "[data-test-toast]");

			const box = await measuredBox(page, "[data-test-toast]");
			assert.equal(Math.round(box.x), 20);
			assert.equal(Math.round(box.x + box.width), EINK_VIEWPORT.width - 20);
			assert.equal(Math.round(box.y + box.height), EINK_VIEWPORT.height - 20);
			assert.equal(Math.round(box.height), 58);

			await expect(page.locator("[data-test-toast]")).toHaveScreenshot(
				`eink-status-toast-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the subscription status chip keeps its contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const email = `eink-subscription-chip-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const created = await page.request.post(`${BASE_URL}/e2e/users`, {
				data: { email, password: PASSWORD, verified: true },
			});
			assert.equal(created.status(), 201, "the e2e user fixture must create the owner");
			const { userId } = CreatedUser.parse(await created.json());
			const seeded = await page.request.post(`${BASE_URL}/e2e/seed-subscription-state`, {
				data: { userId, state: "cancellation-scheduled", at: "2027-03-01T00:00:00.000Z" },
			});
			assert.equal(seeded.status(), 201, "the subscription-state seed endpoint must answer 201");
			await loginAs(page, email);
			await expect(page.locator("[data-test-subscription-chip]")).toBeVisible();
			await settle(page, "[data-test-subscription-banner]");

			await expect(page.locator("[data-test-subscription-banner]")).toHaveScreenshot(
				`eink-subscription-chip-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the empty readlist keeps its contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email } = await createEinkUser(
				page,
				`readlist-empty-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await expect(page.locator("[data-test-empty-readlist]")).toBeVisible();
			await expect(page.locator("#readlist-count")).toHaveText("0 Saved Articles");
			await settle(page, "[data-test-listing]");

			await expect(page.locator(".readlist-listing__header")).toHaveClass(/readlist-listing__header--hidden/);
			const art = await measuredBox(page, '[data-test-empty-readlist] [data-test-illustration="book-lightbulb"]');
			assert.equal(Math.round(art.width), 80);
			assert.equal(Math.round(art.height), 64);
			await expect(page.locator("[data-test-listing]")).toHaveScreenshot(
				`eink-readlist-empty-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the readlist preferences keep their contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email } = await createEinkUser(
				page,
				`readlist-preferences-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			const slug = await createReadlist(page, "Weekend");
			const saved = await page.request.post(`${BASE_URL}/queue/queues/${slug}/preferences?feature=pref`, {
				form: { purpose: "Long-form essays about how teams actually ship software, kept for a slow weekend read." },
			});
			assert.equal(saved.status(), 200, "a saved purpose must land back on the preferences tab");
			await page.goto(`${BASE_URL}/queue/queues/${slug}/preferences?feature=pref`, { waitUntil: "domcontentloaded" });
			await expect(page.locator(READLIST_PREFERENCES)).toHaveAttribute("data-test-preferences-state", "set");
			await expect(page.locator(SETUP_GUIDE)).toBeVisible();
			await page.locator('[data-test-action="readlist-preferences-menu"]').click();
			await expect(page.locator('[data-test-preferences-menu]')).toHaveAttribute("open", "");
			await expect(page.locator('[data-test-action="readlist-preferences-edit"]')).toBeVisible();
			await settle(page, READLIST_LAYOUT);

			await expect(page.locator(READLIST_LAYOUT)).toHaveScreenshot(
				`eink-readlist-preferences-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the reader's readlist tag keeps its contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email, readerUrl } = await seedReaderAndReadlist(
				page,
				`readlist-tag-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await page.goto(readerUrl, { waitUntil: "domcontentloaded" });
			await page.waitForSelector('[data-test-reader-slot][data-reader-status="ready"]');
			await page.click("[data-test-readlists-slot] [data-test-readlists-trigger]");
			await page.locator("[data-test-readlists-menu] [data-test-readlist-create-name]").fill("Weekend");
			await page.click('[data-test-readlists-menu] [data-test-action="readlist-create-assign"]');
			await expect(page.locator("[data-test-readlist-tag]")).toContainText("Weekend");
			await settle(page, "#article-header");

			await expect(page.locator("#article-header")).toHaveScreenshot(
				`eink-reader-readlist-tag-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});
	}

	test("a summary still says it is working when the panel refuses motion", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		const { email, readerUrl } = await seedPendingSummary(
			page,
			`dots-${testInfo.workerIndex}-${Date.now()}`,
		);
		await loginAs(page, email);
		await page.goto(readerUrl, { waitUntil: "domcontentloaded" });

		const loader = page.locator(".article-body__summary-loading svg");
		await expect(loader).toBeVisible();
		const animationName = await loader.evaluate((el) => getComputedStyle(el).animationName);

		assert.equal(animationName, "none", "a panel that refuses motion must not animate");
	});
});
