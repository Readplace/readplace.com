import { readFileSync } from "node:fs";
import { join } from "node:path";

const extensionRoot = join(__dirname, "..", "..");

describe("Chrome Web Store listing strings", () => {
	it("manifest.json carries the listing name and description", () => {
		const manifest = JSON.parse(readFileSync(join(extensionRoot, "src", "runtime", "manifest.json"), "utf-8"));

		expect(manifest.name).toBe("Readplace — Save Articles to Read Later");
		expect(manifest.description).toBe("Save the article. Get back to what you were doing.");
	});
});
