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

describe("save all tabs control", () => {
	it("list-view header carries the save-all-tabs control", () => {
		expect(template).toContain(
			'<button id="save-all-tabs-button" class="list-view__save-all" title="Save all tabs in this window" data-test-save-all-tabs hidden>Save all tabs</button>',
		);
	});
});
