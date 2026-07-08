import assert from "node:assert";
import path from "node:path";
import { test as base, type Page } from "@playwright/test";

export { expect } from "@playwright/test";

const FIXTURES_DIR = path.join(__dirname, "..", "..", "e2e-cdn-fixtures");

export const test = base.extend({
	context: async ({ context }, use) => {
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
		await context.route(
			(url) => url.hostname === "cdnjs.cloudflare.com",
			(route) => {
				const requested = new URL(route.request().url());
				const file = path.basename(requested.pathname);
				const isWebfont = requested.pathname.includes("/webfonts/");
				const contentTypes: Record<string, string> = {
					".css": "text/css",
					".woff2": "font/woff2",
					".ttf": "font/ttf",
				};
				const contentType = contentTypes[path.extname(file)];
				assert(contentType, `unexpected cdnjs asset type requested: ${file}`);
				return route.fulfill({
					path: path.join(FIXTURES_DIR, isWebfont ? "webfonts" : ".", file),
					contentType,
				});
			},
		);
		await context.route(
			(url) => url.hostname === "cdn.jsdelivr.net",
			(route) =>
				route.fulfill({
					path: path.join(FIXTURES_DIR, "htmx.min.client.js"),
					contentType: "text/javascript",
				}),
		);
		await use(context);
	},
});

export async function waitForBrandFonts(page: Page, families: string[]): Promise<void> {
	await page.waitForFunction((wanted) => {
		const loadedFamilies: string[] = [];
		document.fonts.forEach((font) => {
			if (font.status === "loaded") loadedFamilies.push(font.family);
		});
		return wanted.every((family) => loadedFamilies.includes(family));
	}, families);
}
