import assert from "node:assert/strict";
import { buildSiteWebmanifest } from "./site-webmanifest";

describe("buildSiteWebmanifest", () => {
	const manifest = JSON.parse(buildSiteWebmanifest("https://static.readplace.com"));

	it("keeps start_url same-origin so the installed app opens at the document root", () => {
		expect(manifest.start_url).toBe("/");
	});

	it("stamps every icon src absolute to the CDN so icons resolve off the app origin", () => {
		assert.ok(Array.isArray(manifest.icons));
		assert.ok(manifest.icons.length > 0);
		for (const icon of manifest.icons) {
			expect(icon.src.startsWith("https://static.readplace.com/")).toBe(true);
		}
	});

	it("carries the Readplace identity and brand theme colour", () => {
		expect(manifest.name).toBe("Readplace");
		expect(manifest.theme_color).toBe("#2B3A55");
	});

	it("declares both any and maskable icon purposes for adaptive launcher shapes", () => {
		const purposes = manifest.icons.map((icon: { purpose: string }) => icon.purpose);
		expect(purposes).toContain("any");
		expect(purposes).toContain("maskable");
	});
});
