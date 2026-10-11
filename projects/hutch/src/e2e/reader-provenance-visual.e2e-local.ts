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

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SEEDED_BODY = "<p>Seeded article body for the reader provenance visual regression test.</p>";
const OWNER_PASSWORD = "password123";

/** A realistically long list address, so the narrow-viewport baseline pins how the
 * tag behaves when the sender does not fit rather than only the short-address case. */
const NEWSLETTER_SENDER = "the-friday-long-read@newsletters.example.com";

const GENERATED_SUMMARY = {
	summary: "A seeded summary for the reader header baseline.",
	excerpt: "A seeded summary for the reader header baseline.",
};
const SAVED_PIN = { selector: "[data-test-reader-saved]", text: "6h ago" };

const CreatedUser = z.union([
	z.object({ ok: z.literal(true), userId: z.string() }),
	z.object({ ok: z.literal(false), reason: z.string() }),
]);
const SeededArticle = z.object({ articleId: z.string() });

async function createOwner(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: OWNER_PASSWORD },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	const created = CreatedUser.parse(await response.json());
	assert(created.ok, `the e2e user fixture must create the owner ${email}`);
	return created.userId;
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(OWNER_PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function openOwnerReader(
	page: Page,
	params: { stamp: string; provenance: object },
): Promise<void> {
	const email = `provenance-owner-${params.stamp}@example.com`;
	const ownerUserId = await createOwner(page, email);
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/reader-provenance-${params.stamp}`,
			title: "Reader Provenance Visual",
			content: SEEDED_BODY,
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: ownerUserId,
			provenance: params.provenance,
			generatedSummary: GENERATED_SUMMARY,
		},
	});
	assert.equal(response.status(), 201, "seed endpoint must create the crawled article");
	const { articleId } = SeededArticle.parse(await response.json());
	await loginAs(page, email);
	await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
}

async function openPublicView(page: Page, stamp: string): Promise<void> {
	const slug = `reader-header-public-${stamp}`;
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/${slug}`,
			title: "Reader Provenance Visual",
			content: SEEDED_BODY,
			contentFetchedAt: CONTENT_FETCHED_AT,
			generatedSummary: GENERATED_SUMMARY,
		},
	});
	assert.equal(response.status(), 201, "seed endpoint must create the crawled article");
	await page.goto(`${BASE_URL}/view/example.com/${slug}`, { waitUntil: "domcontentloaded" });
}

async function headerSettled(page: Page): Promise<void> {
	await page.waitForSelector("[data-test-reader-provenance]");
	await waitForBrandFonts(page, ["Inter"]);
}

async function publicHeaderSettled(page: Page): Promise<void> {
	await page.waitForSelector("[data-test-reader-title]");
	await waitForBrandFonts(page, ["Inter"]);
}

const FactBox = z.object({
	key: z.string(),
	x: z.number(),
	y: z.number(),
	width: z.number(),
	height: z.number(),
	labelScrollWidth: z.number(),
	labelClientWidth: z.number(),
});

async function factBoxes(page: Page): Promise<z.infer<typeof FactBox>[]> {
	const boxes = await page.evaluate(() =>
		Array.from(document.querySelectorAll("#article-header [data-test-reader-fact]"), (fact) => {
			const box = fact.getBoundingClientRect();
			const label = fact.querySelector(":scope > :not(svg):not(.sr-only)") ?? fact;
			return {
				key: fact.getAttribute("data-test-reader-fact"),
				x: box.x,
				y: box.y,
				width: box.width,
				height: box.height,
				labelScrollWidth: label.scrollWidth,
				labelClientWidth: label.clientWidth,
			};
		}),
	);
	return z.array(FactBox).parse(boxes);
}

function factNamed(facts: z.infer<typeof FactBox>[], key: string): z.infer<typeof FactBox> {
	const fact = facts.find((candidate) => candidate.key === key);
	assert.ok(fact, `the meta row must hold the ${key} fact`);
	return fact;
}

async function noFactPastTheHeader(page: Page): Promise<void> {
	const header = await measuredBox(page, "#article-header");
	for (const fact of await factBoxes(page)) {
		assert.ok(
			fact.x + fact.width <= header.x + header.width + 0.5,
			`the ${fact.key} fact must stay inside the header, ending at ${fact.x + fact.width} past ${header.x + header.width}`,
		);
	}
}

async function everyFactOnOneLine(page: Page): Promise<void> {
	const facts = await factBoxes(page);
	assert.deepEqual(
		facts.map((fact) => fact.key),
		["site", "saved", "read-time", "provenance", "original"],
	);
	for (const fact of facts) {
		assert.ok(Math.abs(fact.y - facts[0].y) <= 0.5, `the ${fact.key} fact must share the first fact's line`);
		assert.ok(Math.abs(fact.height - 24) <= 1, `the ${fact.key} fact must sit on a 24px line, measured ${fact.height}`);
	}
	for (const [index, fact] of facts.slice(1).entries()) {
		const previous = facts[index];
		const gap = fact.x - (previous.x + previous.width);
		assert.ok(Math.abs(gap - 16) <= 1, `the ${fact.key} fact must sit 16px after ${previous.key}, measured ${gap}`);
	}
}

async function originWrapsBelowAWholeSender(page: Page): Promise<void> {
	const facts = await factBoxes(page);
	const site = factNamed(facts, "site");
	const original = factNamed(facts, "original");
	const provenance = factNamed(facts, "provenance");
	assert.ok(
		Math.abs(original.y - site.y - 40) <= 1,
		`Original must wrap to the next 40px row below the site fact, measured ${original.y - site.y}`,
	);
	assert.ok(
		provenance.labelScrollWidth <= provenance.labelClientWidth,
		"the sender must not be truncated while it fits the column",
	);
	await noFactPastTheHeader(page);
}

async function phoneHeaderInsideTheViewport(page: Page): Promise<void> {
	const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
	assert.ok(scrollWidth <= 375, `the page must not scroll sideways at 375px, measured ${scrollWidth}`);
	await noFactPastTheHeader(page);
}

function publicFacts(viewportWidth: number) {
	return async (page: Page): Promise<void> => {
		const facts = await factBoxes(page);
		assert.deepEqual(
			facts.map((fact) => fact.key),
			["site", "read-time", "original"],
		);
		const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
		assert.ok(
			scrollWidth <= viewportWidth,
			`the page must not scroll sideways at ${viewportWidth}px, measured ${scrollWidth}`,
		);
	};
}

function ownerCheckpoint(name: string, geometry: (page: Page) => Promise<void>): VisualCheckpoint {
	return {
		name,
		settled: headerSettled,
		geometry,
		target: "#article-header",
		capture: "element",
		pinnedText: [SAVED_PIN],
	};
}

function publicCheckpoint(name: string, viewportWidth: number): VisualCheckpoint {
	return {
		name,
		settled: publicHeaderSettled,
		geometry: publicFacts(viewportWidth),
		target: "#article-header",
		capture: "element",
		pinnedText: [],
	};
}

const EMAIL_LIGHT = ownerCheckpoint("reader-provenance-email-light", originWrapsBelowAWholeSender);
const EMAIL_DARK = ownerCheckpoint("reader-provenance-email-dark", originWrapsBelowAWholeSender);
const EMAIL_MOBILE = ownerCheckpoint("reader-provenance-email-mobile", phoneHeaderInsideTheViewport);
const CLIENT_LIGHT = ownerCheckpoint("reader-provenance-client-light", everyFactOnOneLine);
const CLIENT_DARK = ownerCheckpoint("reader-provenance-client-dark", everyFactOnOneLine);
const PUBLIC_LIGHT = publicCheckpoint("reader-header-public-light", 1280);
const PUBLIC_PHONE = publicCheckpoint("reader-header-public-phone", 375);

test.describe("Reader save-provenance tag", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("an emailed save shows the list it came from (light)", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `email-light-${Date.now()}`,
			provenance: { kind: "email", senderEmail: NEWSLETTER_SENDER },
		});
		await captureCheckpoint(page, EMAIL_LIGHT);
	});

	test("an emailed save shows the list it came from (dark)", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openOwnerReader(page, {
			stamp: `email-dark-${Date.now()}`,
			provenance: { kind: "email", senderEmail: NEWSLETTER_SENDER },
		});
		await captureCheckpoint(page, EMAIL_DARK);
	});

	test("a save made from a browser extension carries that client's logo", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `client-light-${Date.now()}`,
			provenance: { kind: "client", clientName: "chrome" },
		});
		await expect(page.locator("[data-test-reader-provenance] svg")).toBeVisible();
		await captureCheckpoint(page, CLIENT_LIGHT);
	});

	test("a save made from a browser extension carries that client's logo (dark)", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openOwnerReader(page, {
			stamp: `client-dark-${Date.now()}`,
			provenance: { kind: "client", clientName: "chrome" },
		});
		await expect(page.locator("[data-test-reader-provenance] svg")).toBeVisible();
		await captureCheckpoint(page, CLIENT_DARK);
	});

	test("the public view names only the article's own facts", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPublicView(page, `light-${Date.now()}`);
		await captureCheckpoint(page, PUBLIC_LIGHT);
	});
});

test.describe("Reader save-provenance tag on a narrow viewport", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 375, height: 800 } });

	test("the tag wraps within the column instead of widening the page", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `email-mobile-${Date.now()}`,
			provenance: { kind: "email", senderEmail: NEWSLETTER_SENDER },
		});
		await captureCheckpoint(page, EMAIL_MOBILE);
	});

	test("the public view's header fits a phone", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPublicView(page, `phone-${Date.now()}`);
		await captureCheckpoint(page, PUBLIC_PHONE);
	});
});

test.describe("Reader header on the narrowest phone", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 320, height: 640 } });

	test("a sender too long for the column ellipsizes alone while the bounded facts stay whole", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `email-320-${Date.now()}`,
			provenance: { kind: "email", senderEmail: NEWSLETTER_SENDER },
		});
		await headerSettled(page);
		const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
		assert.ok(scrollWidth <= 320, `the page must not scroll sideways at 320px, measured ${scrollWidth}`);
		const facts = await factBoxes(page);
		for (const key of ["saved", "read-time", "original"]) {
			const fact = factNamed(facts, key);
			assert.equal(
				fact.labelClientWidth,
				fact.labelScrollWidth,
				`the ${key} fact must never be cut, measured ${fact.labelClientWidth} of ${fact.labelScrollWidth}`,
			);
		}
		await noFactPastTheHeader(page);
	});
});
