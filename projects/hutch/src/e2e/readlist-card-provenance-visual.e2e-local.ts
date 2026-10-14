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
import {
	type MeasuredBox,
	measureBoxes,
	measureTextFit,
	pageOverflowsSideways,
	type TextFit,
} from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const CATALOG_COOKIE = "e2e_catalog_ns";
const CATALOG_AT = "2026-09-01T00:00:00.000Z";

const NAMED_SENDER = "hello@weekly-dispatch.example.com";
const NEWSLETTER_NAME = "The Weekly Dispatch";
const LONG_SENDER = "the-friday-long-read@newsletters.example.com";

const ADDRESSED_CARD = {
	url: "https://example.com/card-provenance-addressed",
	title: "An issue from a sender the catalogue does not know",
	senderEmail: LONG_SENDER,
};
const NAMED_CARD = {
	url: "https://example.com/card-provenance-named",
	title: "An issue from a newsletter the catalogue names",
	senderEmail: NAMED_SENDER,
};

const VIA = "[data-test-article-via]";
const VIA_LABEL = ".readlist-article__via-label";
const VIA_SENDER = "[data-test-article-via-sender]";
const CARD_TIME = ".readlist-article__time";
const READER_READY = '[data-test-reader-slot][data-reader-status="ready"]';
const READER_CARD = "[data-test-article-card]";
const READER_SAVED = "[data-test-reader-saved]";
const PROVENANCE = "[data-test-reader-provenance]";
const PROVENANCE_SENDER = "[data-test-reader-provenance-sender]";
const SENDER_NAME = ".sender-popover__name";
const SENDER_ADDRESS = ".sender-popover__address";
const SENDER_LINES = `${SENDER_NAME}, ${SENDER_ADDRESS}`;
const ROW_TOLERANCE = 1.5;
const META_ROW_GAP = 16;
const NAME_FLOOR = 60;
const ONE_LINE_MAX = 24;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function seedCatalog(page: Page, namespace: string): Promise<void> {
	await page.context().addCookies([{ name: CATALOG_COOKIE, value: namespace, url: BASE_URL }]);
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-newsletter-catalog`, {
		data: {
			namespace,
			records: [
				{
					from: NAMED_SENDER,
					name: NEWSLETTER_NAME,
					status: "approved",
					evidence: [],
					createdAt: CATALOG_AT,
					updatedAt: CATALOG_AT,
				},
			],
		},
	});
	assert.equal(seeded.status(), 201, "the newsletter catalog seed must be accepted");
}

async function createOwner(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	return CreatedUser.parse(await response.json()).userId;
}

async function seedEmailedCard(
	page: Page,
	params: { url: string; title: string; senderEmail: string; userId: string },
): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: params.url,
			title: params.title,
			content: "<p>Seeded body for the readlist card provenance baseline.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: params.userId,
			provenance: { kind: "email", senderEmail: params.senderEmail },
			excerpt: "A fixed excerpt for the card provenance baseline, long enough to fill the card's excerpt line.",
			generatedSummary: {
				summary: "Seeded summary for the card provenance baseline.",
				excerpt: "A fixed excerpt for the card provenance baseline, long enough to fill the card's excerpt line.",
			},
		},
	});
	assert.equal(response.status(), 201, "the seed endpoint must create the crawled article");
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function cardId(page: Page, title: string): Promise<string> {
	const id = await page
		.locator("article.readlist-article", {
			has: page.locator("[data-test-article-title]", { hasText: title }),
		})
		.getAttribute("data-test-article");
	assert.ok(id, `a card titled "${title}" must be rendered`);
	return id;
}

async function openReadlistWithEmailedCards(page: Page, stamp: string): Promise<{ named: string; addressed: string }> {
	await seedCatalog(page, `card-provenance-${stamp}`);
	const email = `card-provenance-${stamp}@example.com`;
	const userId = await createOwner(page, email);
	await seedEmailedCard(page, { ...ADDRESSED_CARD, url: `${ADDRESSED_CARD.url}?${stamp}`, userId });
	await seedEmailedCard(page, { ...NAMED_CARD, url: `${NAMED_CARD.url}?${stamp}`, userId });
	await loginAs(page, email);
	await expect(page.locator('[data-card-status="pending"]')).toHaveCount(0);
	return { named: await cardId(page, NAMED_CARD.title), addressed: await cardId(page, ADDRESSED_CARD.title) };
}

function card(id: string): string {
	return `[data-test-article="${id}"]`;
}

async function openReader(page: Page, id: string): Promise<void> {
	await page.goto(`${BASE_URL}/queue/${id}/view`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(READER_READY);
}

async function measureViaLabel(page: Page, id: string): Promise<TextFit> {
	return page.evaluate(measureTextFit, `${card(id)} ${VIA_LABEL}`);
}

async function metaFacts(page: Page, id: string): Promise<MeasuredBox[]> {
	return page.evaluate(measureBoxes, [
		`${card(id)} .readlist-article__site`,
		`${card(id)} .readlist-article__saved`,
		`${card(id)} .readlist-article__read-time`,
		`${card(id)} ${VIA}`,
	]);
}

async function factsWrapToTwoRows(page: Page, id: string): Promise<void> {
	const [site, saved, readTime, via] = await metaFacts(page, id);
	for (const [name, fact, row] of [
		["saved", saved, site],
		["via", via, readTime],
	] as const) {
		assert.ok(
			Math.abs(fact.y - row.y) <= ROW_TOLERANCE,
			`the ${name} fact shares its row where the card is narrow — y ${fact.y} vs ${row.y}`,
		);
	}
	const pitch = site.height + META_ROW_GAP;
	assert.ok(
		Math.abs(via.y - site.y - pitch) <= ROW_TOLERANCE,
		`the via fact sits one row pitch (${pitch}px) below the site where the card is narrow — measured ${via.y - site.y}px`,
	);
	assert.ok(
		via.x > readTime.x + readTime.width,
		`the via fact follows the read time on its row — x ${via.x} vs ${readTime.x + readTime.width}`,
	);
}

async function factsShareOneRow(page: Page, id: string): Promise<void> {
	const [site, saved, readTime, via] = await metaFacts(page, id);
	for (const [name, fact] of [
		["saved", saved],
		["read time", readTime],
		["via", via],
	] as const) {
		assert.ok(
			Math.abs(fact.y - site.y) <= ROW_TOLERANCE,
			`the ${name} fact shares the site's row where the card is wide — y ${fact.y} vs ${site.y}`,
		);
	}
	assert.ok(
		via.x > readTime.x + readTime.width,
		`the via fact follows the read time, in the order site · saved · read time · provenance — x ${via.x} vs ${readTime.x + readTime.width}`,
	);
}

function namedCardCheckpoint(id: string): VisualCheckpoint {
	return {
		name: "readlist-card-provenance-light",
		settled: async (page) => {
			await expect(page.locator(`${card(id)} ${VIA}`)).toHaveText(`via ${NEWSLETTER_NAME}`);
			await waitForBrandFonts(page, ["Inter"]);
			await page.mouse.move(0, 0);
		},
		geometry: async (page) => {
			assert.equal(await page.evaluate(pageOverflowsSideways), false, "the readlist never scrolls sideways");
			const label = await measureViaLabel(page, id);
			assert.ok(
				label.needed <= label.painted,
				`the newsletter name is shown whole — needs ${label.needed}px, paints ${label.painted}px`,
			);
			expect(await page.locator(`${card(id)} ${VIA}`).getAttribute("title")).toBe(NAMED_SENDER);
			await factsWrapToTwoRows(page, id);
		},
		target: card(id),
		capture: "element",
		pinnedText: [{ selector: `${card(id)} ${CARD_TIME}`, text: "3 days ago" }],
	};
}

async function senderSitsAboveItsFact(page: Page, fact: { trigger: string; sender: string }): Promise<void> {
	const trigger = await measuredBox(page, fact.trigger);
	const popover = await measuredBox(page, fact.sender);
	const gap = trigger.y - (popover.y + popover.height);
	assert.ok(Math.abs(gap - 4) <= 1, `the sender popover sits 4px above the fact it names, measured ${gap}px`);
	assert.ok(
		Math.abs(popover.x - trigger.x) <= 1,
		`the sender popover starts at the fact's leading edge — ${popover.x} vs ${trigger.x}`,
	);
	const viewport = page.viewportSize();
	assert.ok(viewport, "the capture needs a fixed viewport");
	assert.ok(popover.x + popover.width <= viewport.width, "the sender popover stays inside the viewport");
	const name = await measuredBox(page, `${fact.sender} ${SENDER_NAME}`);
	const address = await measuredBox(page, `${fact.sender} ${SENDER_ADDRESS}`);
	assert.ok(
		Math.abs(address.y - (name.y + name.height)) <= 1,
		`the sender address sits directly under the newsletter name — ${address.y} vs ${name.y + name.height}`,
	);
	assert.ok(
		Math.abs(address.x - name.x) <= 1,
		`the newsletter name and the sender address share a leading edge — ${name.x} vs ${address.x}`,
	);
}

function senderOpenCheckpoint(id: string): VisualCheckpoint {
	const trigger = `${card(id)} ${VIA}`;
	const sender = `${card(id)} ${VIA_SENDER}`;
	return {
		name: "readlist-card-provenance-sender-light",
		settled: async (page) => {
			await waitForBrandFonts(page, ["Inter"]);
			await page.locator(trigger).click();
			await expect(page.locator(`${sender}:popover-open`).locator(SENDER_LINES)).toHaveText([NEWSLETTER_NAME, NAMED_SENDER]);
			await page.mouse.move(0, 0);
		},
		geometry: (page) => senderSitsAboveItsFact(page, { trigger, sender }),
		target: card(id),
		capture: "element",
		pinnedText: [{ selector: `${card(id)} ${CARD_TIME}`, text: "3 days ago" }],
	};
}

function readerSenderOpenCheckpoint(): VisualCheckpoint {
	return {
		name: "reader-provenance-sender-light",
		settled: async (page) => {
			await expect(page.locator(PROVENANCE)).toHaveText(`via ${NEWSLETTER_NAME}`);
			await waitForBrandFonts(page, ["Inter"]);
			await page.locator(PROVENANCE).click();
			await expect(page.locator(`${PROVENANCE_SENDER}:popover-open`).locator(SENDER_LINES)).toHaveText([NEWSLETTER_NAME, NAMED_SENDER]);
			await page.mouse.move(0, 0);
		},
		geometry: (page) => senderSitsAboveItsFact(page, { trigger: PROVENANCE, sender: PROVENANCE_SENDER }),
		target: READER_CARD,
		capture: "element",
		pinnedText: [{ selector: READER_SAVED, text: "6h ago" }],
	};
}

test.describe("Readlist card provenance", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("an emailed save names the newsletter it came from, and a tap shows its name over the sender address on the card and in the reader", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const { named } = await openReadlistWithEmailedCards(page, `${testInfo.workerIndex}-${Date.now()}`);

		await captureCheckpoint(page, namedCardCheckpoint(named));
		await captureCheckpoint(page, senderOpenCheckpoint(named));

		await openReader(page, named);
		await captureCheckpoint(page, readerSenderOpenCheckpoint());
	});

	test("a sender the catalogue does not know is shown as its address, which gives way with an ellipsis like the site name", async ({
		page,
	}, testInfo) => {
		const { named, addressed } = await openReadlistWithEmailedCards(page, `${testInfo.workerIndex}-${Date.now()}`);
		const via = page.locator(`${card(addressed)} ${VIA}`);
		await expect(via).toHaveText(`via ${LONG_SENDER}`);
		expect(await via.getAttribute("title")).toBe(`via ${LONG_SENDER}`);
		expect(await via.evaluate((el) => el.tagName.toLowerCase())).toBe("span");

		for (const width of [320, 390, 900]) {
			await page.setViewportSize({ width, height: 844 });
			const label = await measureViaLabel(page, addressed);
			assert.equal(
				await page.evaluate(pageOverflowsSideways),
				false,
				`a ${width}px card never scrolls sideways under a long sender`,
			);
			assert.ok(label.height <= ONE_LINE_MAX, `the sender stays on one line at ${width}px — measured ${label.height}px`);
			assert.ok(
				label.painted >= NAME_FLOOR,
				`the sender keeps naming who sent it at ${width}px — painted ${label.painted}px`,
			);
		}

		await page.setViewportSize({ width: 900, height: 844 });
		await factsShareOneRow(page, addressed);
		await factsShareOneRow(page, named);

		await page.setViewportSize({ width: 320, height: 844 });
		const squeezed = await measureViaLabel(page, addressed);
		assert.ok(
			squeezed.needed > squeezed.painted,
			`a 320px row truncates the long sender rather than wrap it — needs ${squeezed.needed}px, paints ${squeezed.painted}px`,
		);
	});
});
