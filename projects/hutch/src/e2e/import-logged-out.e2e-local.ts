import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import type { Page } from "@playwright/test";
import { backdateFormLoad } from "./import-logged-out.browser";
import { clickAndWaitForPageReload } from "./page-interactions";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const SUMMARY_COUNT = "[data-test-import-summary] .import__summary-count";
const UNTICKED_ROWS = [1, 3];

function fixtureUrl(input: { stamp: string; n: number }): string {
	return `${BASE_URL}/e2e/article/import-logged-out-${input.stamp}-${input.n}`;
}

function checkbox(index: number): string {
	return `[data-test-import-checkbox="${index}"]`;
}

async function signUp(page: Page, email: string): Promise<void> {
	await page.waitForSelector("body.page-signup");
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('input[name="loadedAt"]').evaluate(backdateFormLoad);
	await clickAndWaitForPageReload(
		page,
		page.locator('[data-test-action="signup"]'),
	);
}

async function savedArticleUrls(page: Page): Promise<string[]> {
	const links = await page
		.locator("[data-test-article] a[data-test-article-url]")
		.all();
	return Promise.all(
		links.map((link) => link.getAttribute("href").then(String)),
	);
}

test("a logged-out import keeps its review through signup and saves only the ticked links", async ({
	page,
}, testInfo) => {
	const stamp = `${testInfo.workerIndex}-${Date.now()}`;
	const urls = [0, 1, 2, 3, 4].map((n) => fixtureUrl({ stamp, n }));
	const kept = urls.filter((_url, i) => !UNTICKED_ROWS.includes(i));

	await page.goto(`${BASE_URL}/import?mode=upload`, {
		waitUntil: "domcontentloaded",
	});
	await page
		.locator('[data-test-form="upload-file"] input[type="file"]')
		.setInputFiles({
			name: "links.txt",
			mimeType: "text/plain",
			buffer: Buffer.from(urls.join("\n"), "utf-8"),
		});
	await page.waitForSelector("[data-test-import-list]");
	await expect(page.locator(SUMMARY_COUNT)).toHaveText("5");
	await clickAndWaitForPageReload(page, page.locator(checkbox(1)));
	await expect(page.locator(SUMMARY_COUNT)).toHaveText("4");
	await clickAndWaitForPageReload(page, page.locator(checkbox(3)));
	await expect(page.locator(SUMMARY_COUNT)).toHaveText("3");

	await clickAndWaitForPageReload(
		page,
		page.locator('[data-test-action="import-commit"]'),
	);
	await signUp(page, `import-logged-out-${stamp}@example.com`);

	await page.waitForSelector("body.page-import");
	await expect(page.locator("[data-test-import-url]")).toHaveText(urls);
	for (const [i] of urls.entries()) {
		await expect(page.locator(checkbox(i))).toBeChecked({
			checked: !UNTICKED_ROWS.includes(i),
		});
	}
	await expect(page.locator(SUMMARY_COUNT)).toHaveText("3");

	await clickAndWaitForPageReload(
		page,
		page.locator('[data-test-action="import-commit"]'),
	);
	await page.waitForSelector("body.page-readlist");
	await expect(page.locator("[data-test-article]")).toHaveCount(3);
	await expect
		.poll(async () => (await savedArticleUrls(page)).sort())
		.toEqual([...kept].sort());
});

test("a logged-out save signs the reader up and saves the link", async ({
	page,
}, testInfo) => {
	const stamp = `${testInfo.workerIndex}-${Date.now()}`;
	const url = fixtureUrl({ stamp, n: 0 });

	await page.goto(`${BASE_URL}/save?url=${encodeURIComponent(url)}`, {
		waitUntil: "domcontentloaded",
	});
	await signUp(page, `save-logged-out-${stamp}@example.com`);

	await page.waitForSelector("body.page-readlist");
	await expect(page.locator("[data-test-article]")).toHaveCount(1);
	await expect.poll(() => savedArticleUrls(page)).toEqual([url]);
});
