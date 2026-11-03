import { readFileSync } from "node:fs";
import { join } from "node:path";

const extensionRoot = join(__dirname, "..", "..");

describe("Firefox listing strings", () => {
	it("manifest.json carries the listing name and description", () => {
		const manifest = JSON.parse(readFileSync(join(extensionRoot, "src", "runtime", "manifest.json"), "utf-8"));

		expect(manifest.name).toBe("Readplace — Save Articles to Read Later");
		expect(manifest.description).toBe("Save the article. Get back to what you were doing.");
	});

	it("amo-metadata.json carries the listing name, summary and description", () => {
		const metadata = JSON.parse(readFileSync(join(extensionRoot, "amo-metadata.json"), "utf-8"));

		expect(metadata.name["en-US"]).toBe("Readplace — Save Articles to Read Later");
		expect(metadata.summary["en-US"]).toBe("Save the article. Get back to what you were doing.");
		expect(metadata.description["en-US"]).toBe(
			"Readplace is a read-it-later app. Save articles from anywhere and read them later in a clean, focused reader — without the clutter, popups, and noise of the open web.\n\nSAVE FROM ANY TAB\nClick the Readplace button in the toolbar (or press Ctrl+D, Cmd+D on Mac) and the page you are reading is added to your reading list — the full rendered page, not just the link. Right-click a link and choose \"Save Link to Readplace\" to save it without opening it, or save every tab in the window at once with Ctrl+Shift+D.\n\nA CALM READING LIST\nEverything you saved in one place at readplace.com. Open an article to read it in a distraction-free reader, and get an AI summary so you can decide what is worth your time before you dive in.\n\nBUILT ON A DECADE OF READING\nReadplace grew out of a personal reading system refined over ten years. It does one thing well: help you actually read the things you meant to read.\n\nWhen you save a page, its address, title and content are sent to your Readplace account at readplace.com. While you are signed in, the address of the page you are viewing is also checked against your list so the toolbar icon can show whether it is already saved. Privacy policy: https://readplace.com/privacy\n\nA Readplace subscription is required after the free trial.",
		);
	});
});
