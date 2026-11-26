import assert from "node:assert/strict";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { selectPassage } from "./highlight-a-passage.browser";
import {
	armPendingPaintProbe,
	firstLineRectOf,
	passageEdges,
	PENDING_HIGHLIGHT_NAME,
	PENDING_PAINT_STAMP,
	type PendingPaintProbe,
	tintedShare,
} from "./highlight-pending-paint.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const DESKTOP = { width: 1280, height: 900 };
const SETTLE_MS = 45000;

const CONTENT = "[data-test-reader-content]";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const TOOLBAR = "[data-test-highlight-toolbar]";
const HIGHLIGHT_BUTTON = '[data-test-action="highlight"]';
const STATUS = "[data-test-highlight-status]";
const MARK = `${CONTENT} mark.article-highlight`;
const RAIL_ROW = "[data-test-highlight-row]";
const SAVING = "Saving highlight";
const STATUS_REGION = "[data-test-highlight-status-region]";
const STATUS_QUOTE = "[data-test-highlight-status-quote]";
const STOP_WAITING = '[data-test-action="highlight-stop-waiting"]';
const CHECK = '[data-test-action="highlight-check"]';
const RETRY = '[data-test-action="highlight-retry"]';
const DISMISS = '[data-test-action="highlight-status-dismiss"]';
const TOAST = "#status-toast [data-test-toast-message]";

const FILLER_SENTENCE =
	"Every filler paragraph of this seeded article repeats one sentence about keeping a long read in view.";
const FIRST_PASSAGE = "The first passage worth keeping explains why a reader marks a sentence.";
const SECOND_PASSAGE = "The second passage worth keeping says the mark should outlast a reload.";
const ARTICLE = [
	`<p>${FILLER_SENTENCE}</p>`,
	`<p>${FIRST_PASSAGE} It sits in a paragraph of its own.</p>`,
	`<p>${FILLER_SENTENCE}</p>`,
	`<p>${SECOND_PASSAGE} It sits <em>further down</em> the page.</p>`,
	`<p>${FILLER_SENTENCE}</p>`,
].join("");

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });
const Probe: z.ZodType<PendingPaintProbe> = z.object({
	quote: z.string(),
	styled: z.boolean(),
	status: z.string(),
	rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable(),
});

async function openReader(page: Page, stamp: string, query = ""): Promise<void> {
	const email = `highlight-at-once-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/highlight-at-once-${stamp}`,
			title: "Marking a Passage at Once",
			content: ARTICLE,
			contentFetchedAt: "2026-07-10T09:14:00.000Z",
			savedByUserId: userId,
			generatedSummary: { summary: "A fixed summary.", excerpt: "A fixed excerpt." },
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	const { articleId } = SeededArticle.parse(await seeded.json());
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	await page.goto(`${BASE_URL}/queue/${articleId}/view${query}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(READY_SLOT);
}

async function holdCreates(page: Page) {
	let release: (() => void) | undefined;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	const posted: string[] = [];
	let arrived: (() => void) | undefined;
	const arrival = new Promise<void>((resolve) => {
		arrived = resolve;
	});
	let delivered: (() => void) | undefined;
	const delivery = new Promise<void>((resolve) => {
		delivered = resolve;
	});
	await page.route(
		(url) => url.pathname.endsWith("/highlights"),
		async (route) => {
			const request = route.request();
			if (request.method() !== "POST") {
				await route.continue();
				return;
			}
			posted.push(request.postData() ?? "");
			assert(arrived, "the held create must signal its arrival");
			arrived();
			await released;
			const response = await page.request.post(request.url(), {
				headers: request.headers(),
				data: request.postData() ?? "",
				maxRedirects: 0,
			});
			assert(delivered, "the held create must signal its delivery");
			delivered();
			await route.fulfill({ response }).catch(() => undefined);
		},
	);
	return {
		release: () => {
			assert(release, "the held create must expose its release");
			release();
		},
		arrival,
		delivery,
		posted,
	};
}

async function select(page: Page, exact: string): Promise<void> {
	await page.locator(CONTENT).getByText(exact, { exact: false }).scrollIntoViewIfNeeded();
	await page.evaluate(selectPassage, { root: CONTENT, exact });
	await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
}

async function shareOfTint(page: Page, clip: { x: number; y: number; width: number; height: number }) {
	const png = await page.screenshot({ clip });
	return { png, share: await page.evaluate(tintedShare, { png: png.toString("base64"), root: CONTENT }) };
}

for (const colorScheme of ["light", "dark"] as const) {
	test.describe(`Highlighting a passage paints it while the save is held (${colorScheme})`, () => {
		test.use({ timezoneId: "UTC", viewport: DESKTOP, colorScheme });

		test("paints the passage and announces the save on the first frame, then hands over to the saved mark", async ({
			page,
		}, testInfo) => {
			await openReader(page, `paint-${colorScheme}-${testInfo.workerIndex}-${Date.now()}`);
			const held = await holdCreates(page);
			await select(page, FIRST_PASSAGE);
			await page.evaluate(armPendingPaintProbe, {
				button: HIGHLIGHT_BUTTON,
				status: STATUS,
				name: PENDING_HIGHLIGHT_NAME,
				stamp: PENDING_PAINT_STAMP,
			});

			await page.locator(HIGHLIGHT_BUTTON).click();
			await held.arrival;
			await expect(page.locator("html")).toHaveAttribute(PENDING_PAINT_STAMP, /quote/, { timeout: SETTLE_MS });
			const probe = Probe.parse(JSON.parse((await page.locator("html").getAttribute(PENDING_PAINT_STAMP)) ?? ""));
			expect(probe.quote).toBe(FIRST_PASSAGE);
			expect(probe.styled).toBe(true);
			expect(probe.status).toBe(SAVING);
			assert(probe.rect, "the pending paint covers a rendered line");

			const painted = await shareOfTint(page, probe.rect);
			await testInfo.attach(`pending-passage-${colorScheme}`, { body: painted.png, contentType: "image/png" });
			const plain = await shareOfTint(page, await page.evaluate(firstLineRectOf, { root: CONTENT, exact: FILLER_SENTENCE }));
			expect(painted.share).toBeGreaterThan(0.6);
			expect(plain.share).toBeLessThan(0.45);
			expect(held.posted).toHaveLength(1);

			held.release();
			const mark = page.locator(MARK).filter({ hasText: FIRST_PASSAGE });
			await expect(mark).toHaveCount(1, { timeout: SETTLE_MS });
			await expect(page.locator(STATUS)).toHaveText("");
			expect(await page.evaluate((name) => CSS.highlights.has(name), PENDING_HIGHLIGHT_NAME)).toBe(false);

			const highlightId = await mark.getAttribute("data-highlight-id");
			assert(highlightId, "the saved mark carries its highlight id");
			const opened = page.waitForRequest((request) => {
				const url = new URL(request.url());
				return url.pathname.endsWith("/highlights/opened") && url.searchParams.get("highlight") === highlightId;
			});
			await mark.click();
			await opened;
		});
	});
}

test.describe("Selecting again while a highlight is saving", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("keeps a second selection made during the save and highlights it after the first lands", async ({
		page,
	}, testInfo) => {
		await openReader(page, `again-${testInfo.workerIndex}-${Date.now()}`);
		const held = await holdCreates(page);
		await select(page, FIRST_PASSAGE);
		await page.locator(HIGHLIGHT_BUTTON).click();
		await held.arrival;
		const before = await page.evaluate(() => window.scrollY);

		await select(page, SECOND_PASSAGE);
		held.release();
		await expect(page.locator(MARK).filter({ hasText: FIRST_PASSAGE })).toHaveCount(1, { timeout: SETTLE_MS });
		await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(SECOND_PASSAGE);
		expect(await page.evaluate(() => window.scrollY)).toBe(before);
		await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
		await expect(page.locator(HIGHLIGHT_BUTTON)).toBeEnabled();

		await page.locator(HIGHLIGHT_BUTTON).click();
		await expect(page.locator(MARK).filter({ hasText: SECOND_PASSAGE })).toHaveCount(1, { timeout: SETTLE_MS });
		await expect(page.locator(RAIL_ROW)).toHaveCount(2);
		expect(held.posted).toHaveLength(2);
	});

	test("sends one write when a second trigger fires while the first is saving", async ({ page }, testInfo) => {
		await openReader(page, `once-${testInfo.workerIndex}-${Date.now()}`);
		const held = await holdCreates(page);
		await select(page, FIRST_PASSAGE);
		await page.locator(HIGHLIGHT_BUTTON).click();
		await held.arrival;

		await select(page, SECOND_PASSAGE);
		await page.locator(HIGHLIGHT_BUTTON).click();
		held.release();
		await expect(page.locator(MARK).filter({ hasText: FIRST_PASSAGE })).toHaveCount(1, { timeout: SETTLE_MS });
		expect(held.posted).toHaveLength(1);
		await expect(page.locator(MARK).filter({ hasText: SECOND_PASSAGE })).toHaveCount(0);
	});
});

test.describe("Recovering when a highlight save does not answer as expected", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const [reader, query] of [["web", ""], ["iOS app", "?platform=ios"]] as const) {
	test(`a refused passage clears the paint and says why in the ${reader} reader's status`, async ({ page }, testInfo) => {
		await openReader(page, `refused-${reader.length}-${testInfo.workerIndex}-${Date.now()}`, query);
		await page.route(
			(url) => url.pathname.endsWith("/highlights"),
			async (route) => {
				const body = new URLSearchParams(route.request().postData() ?? "");
				body.set("start", "0");
				await route.continue({ postData: body.toString() });
			},
		);
		await select(page, FIRST_PASSAGE);
		await page.locator(HIGHLIGHT_BUTTON).click();

		await expect(page.locator(STATUS)).toHaveText("That passage changed; select it again", { timeout: SETTLE_MS });
		await expect(page.locator(STATUS_REGION)).toBeVisible();
		await expect(page.locator(RETRY)).toBeHidden();
		await expect(page.locator(MARK)).toHaveCount(0);
		expect(await page.evaluate((name) => CSS.highlights.has(name), PENDING_HIGHLIGHT_NAME)).toBe(false);
		await expect(page.locator(TOAST)).toHaveCount(0);

		await page.locator(DISMISS).click();
		await expect(page.locator(DISMISS)).toBeHidden();
		await expect(page.locator(STATUS)).toHaveText("");
		expect(
			await page.locator(STATUS_REGION).evaluate((region) => region.getBoundingClientRect().width),
		).toBeLessThanOrEqual(1);
	});
	}

	test("stopping a stalled save never resends it, and checking reads whether it landed", async ({ page }, testInfo) => {
		await openReader(page, `stalled-${testInfo.workerIndex}-${Date.now()}`);
		const held = await holdCreates(page);
		const checks: { method: string; purpose: string | null; boosted: string | null }[] = [];
		page.on("request", (request) => {
			if (new URL(request.url()).pathname.endsWith("/view") && request.headers().purpose === "prefetch") {
				checks.push({ method: request.method(), purpose: request.headers().purpose, boosted: request.headers()["hx-boosted"] ?? null });
			}
		});
		await select(page, FIRST_PASSAGE);
		await page.locator(HIGHLIGHT_BUTTON).click();
		await held.arrival;

		await page.locator(STOP_WAITING).click({ timeout: SETTLE_MS });
		await expect(page.locator(STATUS)).toHaveText("Readplace may still have saved this passage:");
		await expect(page.locator(STATUS_QUOTE)).toHaveText(FIRST_PASSAGE);
		expect(await page.evaluate((name) => CSS.highlights.has(name), PENDING_HIGHLIGHT_NAME)).toBe(false);

		await page.locator(CHECK).click();
		await expect(page.locator(STATUS)).toHaveText("This passage wasn't highlighted when Readplace checked:", {
			timeout: SETTLE_MS,
		});
		await select(page, SECOND_PASSAGE);
		await expect(page.locator(HIGHLIGHT_BUTTON)).toBeEnabled();

		held.release();
		await held.delivery;
		await page.locator(CHECK).click();
		await expect(page.locator(STATUS)).toHaveText("This passage is highlighted:", { timeout: SETTLE_MS });
		expect(held.posted).toHaveLength(1);
		expect(checks).toEqual([
			{ method: "GET", purpose: "prefetch", boosted: null },
			{ method: "GET", purpose: "prefetch", boosted: null },
		]);
		await expect(page.locator(MARK)).toHaveCount(0);
	});
});

for (const releasedAt of ["before the first movement", "midway through the drag"] as const) {
	test.describe(`A save answering ${releasedAt} of a second selection`, () => {
		test.use({ timezoneId: "UTC", viewport: DESKTOP });

		test("waits for the drag to end before replacing the text, then keeps the new selection", async ({ page }, testInfo) => {
			await openReader(page, `drag-${releasedAt.length}-${testInfo.workerIndex}-${Date.now()}`);
			const held = await holdCreates(page);
			await select(page, FIRST_PASSAGE);
			await page.locator(HIGHLIGHT_BUTTON).click();
			await held.arrival;
			await page.locator(CONTENT).getByText(SECOND_PASSAGE, { exact: false }).scrollIntoViewIfNeeded();
			const edges = await page.evaluate(passageEdges, { root: CONTENT, exact: SECOND_PASSAGE });
			const landed = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/view"));

			await page.mouse.move(edges.start.x, edges.start.y);
			await page.mouse.down();
			if (releasedAt === "midway through the drag") {
				await page.mouse.move((edges.start.x + edges.end.x) / 2, edges.end.y, { steps: 5 });
			}
			held.release();
			await landed;
			await expect(page.locator(MARK)).toHaveCount(0);
			await page.mouse.move(edges.end.x, edges.end.y, { steps: 5 });
			await page.mouse.up();

			await expect(page.locator(MARK).filter({ hasText: FIRST_PASSAGE })).toHaveCount(1, { timeout: SETTLE_MS });
			await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(SECOND_PASSAGE);
			await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
			expect(held.posted).toHaveLength(1);
		});
	});
}
