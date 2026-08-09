import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brandMarkSvg } from "@packages/web-shell";

const template = readFileSync(
	join(__dirname, "..", "..", "..", "src", "runtime", "popup", "popup.template.html"),
	"utf-8",
);

describe("popup brand mark", () => {
	it("login view carries the exact brandMarkSvg output", () => {
		expect(template).toContain(brandMarkSvg({ className: "login__icon" }));
	});

	it("list-view header carries the exact brandMarkSvg output", () => {
		expect(template).toContain(brandMarkSvg({ className: "list-view__brand-icon" }));
	});
});

describe("save all tabs progress", () => {
	it("save-all view tells the reader the save survives closing the popup", () => {
		expect(template).toContain(
			'<p id="save-all-hint" class="saved-view__subtitle" data-test-save-all-hint>Saving continues if you close this. We&rsquo;ll notify you when it&rsquo;s done.</p>',
		);
	});
});

describe("save all tabs control", () => {
	it("list-view header carries the save-all-tabs control", () => {
		expect(template).toContain(
			'<button id="save-all-tabs-button" class="list-view__save-all" title="Save all tabs in this window" data-test-save-all-tabs hidden>Save all tabs</button>',
		);
	});
});

describe("shortcut hints", () => {
	it("names the save shortcut before any script has read the configured binding", () => {
		expect(template).toContain(
			'<p id="save-shortcut-hint" class="shortcut-hint">Tip: Use <kbd>Ctrl</kbd>+<kbd>D</kbd> to save from any page</p>',
		);
	});

	it("keeps the save-all shortcut hidden until the server advertises bulk save", () => {
		expect(template).toContain(
			'<p id="save-all-shortcut-hint" class="shortcut-hint" hidden>Tip: Use <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> to save all tabs</p>',
		);
	});
});
