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

	it("save-all view carries the failed-tab list, hidden until a save fails", () => {
		expect(template).toContain(
			'<ul class="save-all-view__failed" data-test-save-all-failed hidden></ul>',
		);
	});
});

describe("save all tabs control", () => {
	it("list-view header carries the save-all-tabs control, counting what it will send above its scope", () => {
		expect(template).toContain(
			[
				'        <button id="save-all-tabs-button" class="list-view__save-all" title="Save all tabs in this window" data-test-save-all-tabs hidden>',
				'          <span class="list-view__save-all-count" data-test-save-all-count>Save tabs</span>',
				'          <span class="list-view__save-all-scope">This window</span>',
				"        </button>",
			].join("\n"),
		);
	});
});

describe("shortcut hints", () => {
	it("closes the single-save view with the save shortcut, so one save teaches only its own key", () => {
		expect(template).toContain(
			[
				'    <div id="saved-affordances"></div>',
				'    <p id="save-shortcut-hint" class="shortcut-hint">Tip: Use <kbd>Ctrl</kbd>+<kbd>D</kbd> to save from any page</p>',
				"  </div>",
			].join("\n"),
		);
	});

	it("closes the bulk-save view with the save-all shortcut, hidden until the server advertises bulk save", () => {
		expect(template).toContain(
			[
				'    <button id="save-all-view-queue" class="saved-view__action" hidden>View Queue</button>',
				'    <p id="save-all-shortcut-hint" class="shortcut-hint" hidden>Tip: Use <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> to save all tabs</p>',
				"  </div>",
			].join("\n"),
		);
	});

	it("carries each hint exactly once, so neither view teaches the other's key", () => {
		expect(template.split('id="save-shortcut-hint"')).toHaveLength(2);
		expect(template.split('id="save-all-shortcut-hint"')).toHaveLength(2);
	});
});
