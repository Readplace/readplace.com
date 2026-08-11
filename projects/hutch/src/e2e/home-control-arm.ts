import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { EXPERIMENT_COOKIE_NAME } from "../runtime/web/experiments/homepage-assignment";
import {
	HOMEPAGE_SPLIT,
	type HomepageSplitVariant,
} from "../runtime/web/experiments/homepage-split";
import { waitForBrandFonts } from "@packages/e2e-harness";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const HOME_CLIENT_BUNDLE = "**/client-dist/home.client.js";

export const CONTROL_ARM = HOMEPAGE_SPLIT.variants[0];

interface OpenHomepageOptions {
	variant: HomepageSplitVariant;
	/** "stubbed" freezes the rotators so a geometry guard measures the CSS
	 * reservation alone; "live" is the page a visitor actually runs. */
	clientBundle: "stubbed" | "live";
}

export async function openHomepage(page: Page, options: OpenHomepageOptions): Promise<void> {
	if (options.clientBundle === "stubbed") {
		await page.route(HOME_CLIENT_BUNDLE, (route) =>
			route.fulfill({ contentType: "text/javascript", body: "" }),
		);
	}
	const assignment = `${HOMEPAGE_SPLIT.campaign}:${HOMEPAGE_SPLIT.epoch}:${options.variant.slug}`;
	await page
		.context()
		.addCookies([{ name: EXPERIMENT_COOKIE_NAME, value: assignment, url: BASE_URL }]);
	await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-home");
	const bodyClass = await page.locator("body").getAttribute("class");
	assert.ok(bodyClass, "the homepage must identify itself through a body class");
	assert.ok(
		bodyClass.split(" ").includes(`variant-${options.variant.marker}`),
		`the ${EXPERIMENT_COOKIE_NAME} cookie must pin the homepage to arm "${options.variant.slug}", rendered "${bodyClass}"`,
	);
	await waitForBrandFonts(page, ["Inter"]);
}
