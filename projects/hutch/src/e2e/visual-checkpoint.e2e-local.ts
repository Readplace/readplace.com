import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { test } from "./hermetic-cdn";
import { captureCheckpoint, measuredBox, type VisualCheckpoint } from "./visual-checkpoint";

async function loginPageSettled(page: Page): Promise<void> {
	await page.waitForSelector("body.page-login");
}

async function impossibleEmailFieldGeometry(page: Page): Promise<void> {
	const emailField = await measuredBox(page, 'input[name="email"]');
	assert.ok(emailField.width >= 100000, "login email field width must reach 100000px");
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
			pinnedText: [{ selector: ".auth-card__title", text: "Pinned title" }],
		};
		await assert.rejects(
			captureCheckpoint(page, violatedGeometryCheckpoint),
			/email field width/,
		);
	});
});
