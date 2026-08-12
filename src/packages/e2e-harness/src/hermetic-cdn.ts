import path from "node:path";
import { test as base, type BrowserContext, type Page } from "@playwright/test";

export { expect } from "@playwright/test";

/** Ships inside the package rather than being passed in by each consumer: the
 * fixture set is the closure of the shared shell's third-party requests, so it
 * is the same everywhere, and a per-consumer path invites pinning a partial
 * closure — which fails only as an intermittent network-dependent flake. */
const FIXTURES_DIR = path.join(__dirname, "..", "e2e-cdn-fixtures");

export async function pinCdnFixtures(context: BrowserContext): Promise<void> {
	await context.route(
		(url) => url.hostname === "fonts.googleapis.com",
		(route) =>
			route.fulfill({
				path: path.join(FIXTURES_DIR, "inter.css"),
				contentType: "text/css",
			}),
	);
	await context.route(
		(url) => url.hostname === "fonts.gstatic.com",
		(route) => {
			const file = path.basename(new URL(route.request().url()).pathname);
			return route.fulfill({
				path: path.join(FIXTURES_DIR, "gstatic", file),
				contentType: "font/woff2",
			});
		},
	);
}

export const cdnContextFixture = async (
	{ context }: { context: BrowserContext },
	use: (pinned: BrowserContext) => Promise<void>,
): Promise<void> => {
	await pinCdnFixtures(context);
	await use(context);
};

export const test = base.extend({ context: cdnContextFixture });

export async function waitForBrandFonts(page: Page, families: string[]): Promise<void> {
	await page.waitForFunction((wanted) => {
		// Gecko reports FontFace.family with the quotes the @font-face rule was
		// written with (`"Inter"`); Blink reports the bare family. Comparing raw
		// strings therefore never matches in Firefox and waits out the timeout.
		const unquote = (family: string) => family.replace(/^["']|["']$/g, "");
		const loadedFamilies: string[] = [];
		document.fonts.forEach((font) => {
			if (font.status === "loaded") loadedFamilies.push(unquote(font.family));
		});
		return wanted.every((family) => loadedFamilies.includes(unquote(family)));
	}, families);
}
