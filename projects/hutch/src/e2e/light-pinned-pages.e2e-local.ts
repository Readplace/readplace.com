import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { type ThemeSignature, collectThemeSignature } from "./theme-signature.browser";

const BASE_URL = `http://localhost:${requireEnv("E2E_PORT")}`;
const VIEWPORT = { width: 1280, height: 900 };

interface PinnedPage {
	path: string;
	bodyClass: string;
	open?: (page: Page) => Promise<void>;
}

async function openSaveTip(page: Page, urlField: string): Promise<void> {
	await page.locator(urlField).first().focus();
	await expect(page.locator("[data-test-confirm-popover='save-tip']")).toBeVisible();
}

const PINNED_PAGES: readonly PinnedPage[] = [
	{
		path: "/",
		bodyClass: "page-home",
		open: (page) => openSaveTip(page, "[data-test-hero-input]"),
	},
	{ path: "/login", bodyClass: "page-login" },
	{ path: "/signup", bodyClass: "page-signup" },
	{
		path: "/import",
		bodyClass: "page-import",
		open: (page) => openSaveTip(page, "[data-test-import-from-url-input]"),
	},
	{ path: "/install?client=chrome", bodyClass: "page-install" },
	{ path: "/pocket-alternative", bodyClass: "page-landing" },
];

async function signatureUnder(
	page: Page,
	pinned: PinnedPage,
	scheme: "light" | "dark",
): Promise<ThemeSignature> {
	await page.context().clearCookies();
	await page.emulateMedia({ colorScheme: scheme });
	await page.goto(`${BASE_URL}${pinned.path}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(`body.${pinned.bodyClass}`);
	await pinned.open?.(page);
	return page.evaluate(collectThemeSignature);
}

function firstRepaint(
	light: ThemeSignature,
	dark: ThemeSignature,
): { name: string; light: string; dark: string } | undefined {
	for (const [index, painted] of light.painted.entries()) {
		const under = dark.painted[index];
		if (under === undefined) return { name: painted.name, light: painted.styles, dark: "absent" };
		if (under.styles !== painted.styles) {
			return { name: painted.name, light: painted.styles, dark: under.styles };
		}
	}
	return undefined;
}

test.describe("A logged-out page paints the palette it was designed for", () => {
	test.use({ timezoneId: "UTC", viewport: VIEWPORT });

	for (const pinned of PINNED_PAGES) {
		test(`${pinned.path} paints the same colours under a dark system theme`, async ({ page }) => {
			const light = await signatureUnder(page, pinned, "light");
			const dark = await signatureUnder(page, pinned, "dark");

			assert.ok(
				light.bodyClass.split(/\s+/).includes("theme-light"),
				`${pinned.path} must be pinned light while logged out, but rendered "${light.bodyClass}"`,
			);
			assert.equal(
				dark.rootColorScheme,
				"light",
				`${pinned.path} pins the light palette, so its root element must not report a dark colour scheme`,
			);
			assert.equal(
				dark.painted.length,
				light.painted.length,
				`${pinned.path} rendered a different number of elements under each system theme`,
			);

			const repainted = firstRepaint(light, dark);
			assert.equal(
				repainted,
				undefined,
				repainted &&
					`${pinned.path} repaints ${repainted.name} when the viewer's system theme is dark:\n  light: ${repainted.light}\n  dark:  ${repainted.dark}`,
			);
		});
	}
});
