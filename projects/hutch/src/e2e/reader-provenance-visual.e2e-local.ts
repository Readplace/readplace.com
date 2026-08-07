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
	await page.waitForSelector("body.page-queue");
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
		},
	});
	assert.equal(response.status(), 201, "seed endpoint must create the crawled article");
	const { articleId } = SeededArticle.parse(await response.json());
	await loginAs(page, email);
	await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
}

async function headerSettled(page: Page): Promise<void> {
	await page.waitForSelector("[data-test-reader-provenance]");
	await waitForBrandFonts(page, ["Inter"]);
}

async function noGeometryConstraint(): Promise<void> {}

/** The meta row wraps rather than scrolls: a long sender must never widen the
 * header past the column it sits in. */
async function tagStaysInsideTheHeader(page: Page): Promise<void> {
	const header = await measuredBox(page, "#article-header");
	const tag = await measuredBox(page, "[data-test-reader-provenance]");
	assert.ok(
		tag.x + tag.width <= header.x + header.width + 0.5,
		"the provenance tag must ellipsize inside the header, not overflow it",
	);
}

const EMAIL_LIGHT: VisualCheckpoint = {
	name: "reader-provenance-email-light",
	settled: headerSettled,
	geometry: tagStaysInsideTheHeader,
	target: "#article-header",
	capture: "element",
	pinnedText: [],
};

const EMAIL_DARK: VisualCheckpoint = {
	name: "reader-provenance-email-dark",
	settled: headerSettled,
	geometry: tagStaysInsideTheHeader,
	target: "#article-header",
	capture: "element",
	pinnedText: [],
};

const EMAIL_MOBILE: VisualCheckpoint = {
	name: "reader-provenance-email-mobile",
	settled: headerSettled,
	geometry: tagStaysInsideTheHeader,
	target: "#article-header",
	capture: "element",
	pinnedText: [],
};

const CLIENT_LIGHT: VisualCheckpoint = {
	name: "reader-provenance-client-light",
	settled: headerSettled,
	geometry: noGeometryConstraint,
	target: "#article-header",
	capture: "element",
	pinnedText: [],
};

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
});

test.describe("Reader save-provenance tag on a narrow viewport", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 375, height: 800 } });

	test("the tag wraps within the column instead of widening the page", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `email-mobile-${Date.now()}`,
			provenance: { kind: "email", senderEmail: NEWSLETTER_SENDER },
		});
		const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
		assert.ok(
			scrollWidth <= 375,
			`the page must not scroll sideways at 375px, measured ${scrollWidth}`,
		);
		await captureCheckpoint(page, EMAIL_MOBILE);
	});
});
