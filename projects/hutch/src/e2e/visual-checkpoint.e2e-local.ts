import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
	measuredBox,
	pinCdnFixtures,
	test,
	type VisualCheckpoint,
} from "@packages/e2e-harness";

async function loginPageSettled(page: Page): Promise<void> {
	await page.waitForSelector("body.page-login");
}

async function impossibleEmailFieldGeometry(page: Page): Promise<void> {
	const emailField = await measuredBox(page, 'input[name="email"]');
	assert.ok(emailField.width >= 100000, "login email field width must reach 100000px");
}

async function alignedAuthFieldsGeometry(page: Page): Promise<void> {
	const email = await measuredBox(page, 'input[name="email"]');
	const password = await measuredBox(page, 'input[name="password"]');
	assert.equal(password.x, email.x, "login email and password fields must share a left edge");
}

test.describe("Visual checkpoint failure detection", () => {
	test("a checkpoint whose target matches nothing rejects instead of capturing", async ({
		page,
	}) => {
		await page.goto("/login", { waitUntil: "domcontentloaded" });
		const staleTargetCheckpoint: VisualCheckpoint = {
			name: "stale-target-never-captured",
			settled: loginPageSettled,
			geometry: impossibleEmailFieldGeometry,
			target: "[data-test-visual-checkpoint-missing]",
			capture: "element",
			pinnedText: [],
		};
		await assert.rejects(captureCheckpoint(page, staleTargetCheckpoint), /matched 0 elements/);
	});

	test("a violated geometry contract rejects instead of capturing", async ({ page }) => {
		await page.goto("/login", { waitUntil: "domcontentloaded" });
		const violatedGeometryCheckpoint: VisualCheckpoint = {
			name: "violated-geometry-never-captured",
			settled: loginPageSettled,
			geometry: impossibleEmailFieldGeometry,
			target: 'input[name="email"]',
			capture: "element",
			pinnedText: [{ selector: ".auth-card__title", text: "Pinned title" }],
		};
		await assert.rejects(
			captureCheckpoint(page, violatedGeometryCheckpoint),
			/email field width/,
		);
	});

	test.describe("without a fixed viewport", () => {
		test("a page-from-top checkpoint rejects instead of capturing", async ({
			browser,
			baseURL,
		}) => {
			assert.ok(baseURL, "the Playwright config must set a baseURL");
			const context = await browser.newContext({
				viewport: null,
				deviceScaleFactor: undefined,
				baseURL,
			});
			await pinCdnFixtures(context);
			const page = await context.newPage();
			await page.goto("/login", { waitUntil: "domcontentloaded" });
			const pageFromTopWithoutViewport: VisualCheckpoint = {
				name: "page-from-top-without-viewport-never-captured",
				settled: loginPageSettled,
				geometry: alignedAuthFieldsGeometry,
				target: 'input[name="email"]',
				capture: "page-from-top",
				pinnedText: [],
			};
			await assert.rejects(
				captureCheckpoint(page, pageFromTopWithoutViewport),
				/requires a fixed viewport/,
			);
			await context.close();
		});
	});
});
