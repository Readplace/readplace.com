import assert from "node:assert/strict";
import { findIconSvg, type IconName, iconSvg, type SolidIconName } from "./ui-icons";

describe("findIconSvg", () => {
	it("resolves a known name to the same markup as the typed call", () => {
		expect(findIconSvg("arrow-right")).toBe(iconSvg("arrow-right"));
	});

	it("draws the pencil the queue rail names its rename affordance with", () => {
		expect(findIconSvg("pencil")).toBe(iconSvg("pencil"));
	});

	it("resolves the trash icon the queue rail names its delete affordance with", () => {
		expect(findIconSvg("trash")).toBe(iconSvg("trash"));
	});

	it("resolves the ellipsis icons a row menu names its overflow affordance with", () => {
		expect(findIconSvg("ellipsis")).toBe(iconSvg("ellipsis"));
		expect(findIconSvg("ellipsis-vertical")).toBe(iconSvg("ellipsis-vertical"));
	});

	it("resolves the copy icon a copy control names its action with", () => {
		expect(findIconSvg("copy")).toBe(iconSvg("copy"));
	});

	it("resolves the link icon an email row marks its link count with", () => {
		expect(findIconSvg("link")).toBe(iconSvg("link"));
	});

	it("resolves the chevrons a pager steps with", () => {
		expect(findIconSvg("chevron-left")).toBe(iconSvg("chevron-left"));
		expect(findIconSvg("chevron-right")).toBe(iconSvg("chevron-right"));
	});

	it("resolves the warning and info glyphs named by alert variants", () => {
		expect(findIconSvg("alert-triangle")).toBe(iconSvg("alert-triangle"));
		expect(findIconSvg("info")).toBe(iconSvg("info"));
	});

	it("reports an unknown name rather than drawing nothing, so a caller can fail a typo", () => {
		expect(findIconSvg("fa-solid fa-inbox")).toBeUndefined();
		expect(findIconSvg("constructor")).toBeUndefined();
	});
});

const STROKE_NAMES: readonly IconName[] = [
	"alert-triangle",
	"arrow-down",
	"arrow-left",
	"arrow-right",
	"arrow-up",
	"book",
	"check",
	"check-circle",
	"chevron-down",
	"chevron-left",
	"chevron-right",
	"copy",
	"download",
	"ellipsis",
	"ellipsis-vertical",
	"file",
	"file-down",
	"folder",
	"inbox",
	"info",
	"link",
	"loader",
	"log-in",
	"log-out",
	"mail",
	"menu",
	"note",
	"pencil",
	"plug",
	"plus",
	"share",
	"sparkles",
	"trash",
	"upload",
	"user",
	"x",
	"x-circle",
];

const FACT_NAMES: readonly IconName[] = ["clock", "eye", "globe"];

const SOLID_NAMES: readonly SolidIconName[] = ["book", "file", "file-down", "folder", "inbox", "sparkles"];

function openTag(svg: string): string {
	const match = svg.match(/^<svg [^>]*>/);
	assert(match, "an icon must open with an <svg> tag");
	return match[0];
}

describe("the stroke set", () => {
	it.each(STROKE_NAMES)("draws %s at the 1.5px Hugeicons stroke in currentColor", (name) => {
		const open = openTag(iconSvg(name));

		expect(open).toContain('stroke-width="1.5"');
		expect(open).toContain('stroke="currentColor"');
		expect(open).toContain('fill="none"');
	});

	it.each([...STROKE_NAMES, ...FACT_NAMES])("resolves %s by name to the same markup as the typed call", (name) => {
		expect(findIconSvg(name)).toBe(iconSvg(name));
	});

	it("resolves the menu glyph the phone nav toggle names", () => {
		expect(findIconSvg("menu")).toBe(iconSvg("menu"));
	});

	it("draws the file glyph the default readlist names, distinct from the folder a custom readlist draws", () => {
		expect(iconSvg("file")).not.toBe(iconSvg("folder"));
	});

	it("hides every drawing from assistive tech so its label names the control", () => {
		for (const name of [...STROKE_NAMES, ...FACT_NAMES]) {
			const open = openTag(iconSvg(name));
			expect(open).toContain('aria-hidden="true"');
			expect(open).toContain('focusable="false"');
		}
	});
});

describe("the fact glyphs", () => {
	it.each(FACT_NAMES)("fills %s in currentColor under a fill-based open tag so a --fact-* colour tints it", (name) => {
		const svg = iconSvg(name);
		const open = openTag(svg);

		expect(open).toContain('fill="currentColor"');
		expect(open).not.toContain("stroke");
		expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b/i);
	});
});

describe("the solid variant", () => {
	it.each(SOLID_NAMES)("fills %s in currentColor, a different drawing from its stroke glyph", (name) => {
		const solid = iconSvg(name, { variant: "solid" });

		expect(openTag(solid)).toContain('fill="currentColor"');
		expect(solid).not.toMatch(/#[0-9a-f]{3,8}\b/i);
		expect(solid).not.toBe(iconSvg(name));
		expect(findIconSvg(name, "solid")).toBe(solid);
	});

	it("exists only for the six names a current nav or rail item draws", () => {
		const solidNames = [...STROKE_NAMES, ...FACT_NAMES].filter((name) => findIconSvg(name, "solid") !== undefined);

		expect(new Set(solidNames)).toEqual(new Set(SOLID_NAMES));
	});

	it("draws the stroke glyph when the stroke variant is named explicitly", () => {
		expect(iconSvg("book", { variant: "stroke" })).toBe(iconSvg("book"));
		expect(findIconSvg("book", "stroke")).toBe(iconSvg("book"));
	});

	it("fails loudly on a variant outside the set rather than drawing nothing", () => {
		expect(() => findIconSvg("book", "duotone")).toThrow('There is no "duotone" icon variant');
		expect(() => findIconSvg("book", "constructor")).toThrow('There is no "constructor" icon variant');
	});
});
