import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brandMarkSvg } from "@packages/web-shell";

const template = readFileSync(
	join(__dirname, "..", "..", "..", "src", "runtime", "popup", "popup.template.html"),
	"utf-8",
);

const FONT = "Georgia, 'Times New Roman', serif";

describe("popup brand mark", () => {
	it("login view carries the exact brandMarkSvg output", () => {
		expect(template).toContain(brandMarkSvg({ fontFamily: FONT, className: "login__icon" }));
	});

	it("list-view header carries the exact brandMarkSvg output", () => {
		expect(template).toContain(
			brandMarkSvg({ fontFamily: FONT, className: "list-view__brand-icon" }),
		);
	});
});
