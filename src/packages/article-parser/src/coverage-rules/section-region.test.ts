import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { inspectRegion, type SectionRegion } from "./section-region";

const PAGE = "https://example.com/guide";

function words(prefix: string, count: number): string {
	return Array.from({ length: count }, (_, i) => `${prefix}w${i}`).join(" ");
}

function section(n: number, count = 50): string {
	return `<div id="s${n}"><h2>Section ${n}</h2><p>${words(`s${n}`, count)}</p></div>`;
}

const TOC = '<nav><a href="#s1">1</a><a href="#s2">2</a><a href="#s3">3</a><a href="#s4">4</a><a href="#">top</a></nav>';
const SECTIONS = [1, 2, 3].map((n) => section(n)).join("");

function regionOf(bodyHtml: string): SectionRegion {
	const { document } = parseHTML(`<!DOCTYPE html><html><head></head><body>${TOC}${bodyHtml}</body></html>`);
	return inspectRegion({ document, documentUrl: PAGE });
}

function unitCount(region: SectionRegion): number | string {
	return region.kind === "region" ? region.units.length : region.reason;
}

function fixtureRegion(params: { name: string; documentUrl: string }): SectionRegion {
	const html = readFileSync(join(__dirname, "..", "fixtures", params.name), "utf8");
	return inspectRegion({ document: parseHTML(html).document, documentUrl: params.documentUrl });
}

describe("inspectRegion on the real captures", () => {
	it.each([
		["coverage-psn-control.html", "https://psnprofiles.com/guide/16422-silent-hill-f-trophy-guide", "sections", 14],
		["coverage-psn-silent-hill.html", "https://psnprofiles.com/guide/16422-silent-hill-f-trophy-guide", "sections", 7],
		["coverage-git-rebase.html", "https://git-scm.com/docs/git-rebase", "main", 16],
	])("finds the section holder of %s", (name, documentUrl, rootId, units) => {
		const region = fixtureRegion({ name, documentUrl });
		expect(region.kind === "region" && region.root.id).toBe(rootId);
		expect(unitCount(region)).toBe(units);
	});
});

describe("inspectRegion", () => {
	it("descends through wrappers to the element whose children are the sections", () => {
		const region = regionOf(`<div id="wrap"><div id="sections">${SECTIONS}</div></div>`);
		expect(region.kind === "region" && region.root.id).toBe("sections");
		expect(unitCount(region)).toBe(3);
	});

	it("keeps an unheaded introduction as a leading unit and an unheaded appendix in the last unit", () => {
		const region = regionOf(`<div id="sections"><p>${words("intro", 30)}</p>${SECTIONS}<p>${words("tail", 5)}</p></div>`);
		expect(region.kind === "region" && region.units.map((unit) => [unit.leading, unit.nodes.length])).toEqual([
			[true, 1],
			[false, 1],
			[false, 1],
			[false, 2],
		]);
	});

	it("drops a leading unit that holds only whitespace and comments", () => {
		expect(unitCount(regionOf(`<div id="sections">\n<!-- start -->\n${SECTIONS}</div>`))).toBe(3);
	});

	it("keeps a leading unit that holds an owned element without words", () => {
		expect(unitCount(regionOf(`<div id="sections"><img src="/a.png">${SECTIONS}</div>`))).toBe(4);
	});

	it("forms units from flat headings and paragraphs", () => {
		const flat = [1, 2, 3, 4].map((n) => `<h2 id="s${n}">Part ${n}</h2><p>${words(`f${n}`, 45)}</p>`).join("");
		expect(unitCount(regionOf(`<div id="flat">${flat}</div>`))).toBe(4);
	});

	it("forms units from legacy named anchors with no heading", () => {
		const legacy = [1, 2, 3].map((n) => `<a name="s${n}"></a><p>${words(`l${n}`, 45)}</p>`).join("");
		expect(unitCount(regionOf(`<div id="legacy">${legacy}</div>`))).toBe(3);
	});

	it("forms units from linked holders with no heading", () => {
		const holders = [1, 2, 3].map((n) => `<div id="s${n}"><!-- c --><p>${words(`t${n}`, 45)}</p></div>`).join("");
		expect(unitCount(regionOf(`<div id="holders">${holders}</div>`))).toBe(3);
	});

	it("reads a heading hidden in an unowned element as no heading", () => {
		const holders = [1, 2, 3]
			.map((n) => `<div id="s${n}"><aside><h2>Aside</h2></aside><a id="other${n}"></a><p>${words(`h${n}`, 45)}</p></div>`)
			.join("");
		expect(unitCount(regionOf(`<div id="holders">${holders}</div>`))).toBe(3);
	});

	it("abstains when one unit dominates and nothing below it has sections", () => {
		const region = regionOf(`<div>${section(1, 500)}${section(2, 10)}${section(3, 10)}</div>`);
		expect(unitCount(region)).toBe("no-section-structure");
	});

	it("abstains when no child holds most of the words", () => {
		expect(unitCount(regionOf(`<div>${words("a", 50)}</div><div>${words("b", 50)}</div>`))).toBe("no-section-structure");
	});

	it("abstains on a directory of short entries", () => {
		const directory = [1, 2, 3, 4].map((n) => section(n, 10)).join("");
		expect(unitCount(regionOf(`<div>${directory}</div>`))).toBe("no-section-structure");
	});

	it("abstains when the section headings link to other pages", () => {
		const linked = [1, 2, 3]
			.map((n) => `<div id="s${n}"><h2><a href="/other/${n}">Entry ${n}</a></h2><p>${words(`o${n}`, 50)}</p></div>`)
			.join("");
		expect(unitCount(regionOf(`<div>${linked}</div>`))).toBe("off-page-sections");
	});

	it("abstains when the legacy anchors themselves link to other pages", () => {
		const legacy = [1, 2, 3].map((n) => `<a name="s${n}" href="/x/${n}"></a><p>${words(`k${n}`, 45)}</p>`).join("");
		expect(unitCount(regionOf(`<div>${legacy}</div>`))).toBe("off-page-sections");
	});

	it("abstains on a teaser block inside the section flow", () => {
		const teasers = [1, 2, 3].map((n) => `<li><h3>Story ${n}</h3><p>Teaser for story ${n}.</p></li>`).join("");
		expect(unitCount(regionOf(`<div>${SECTIONS}<div><ul>${teasers}</ul></div></div>`))).toBe("adjacent-repeated-block");
	});

	it("abstains on prose outside the region", () => {
		expect(unitCount(regionOf(`<div><p>${words("out", 60)}</p><div>${SECTIONS}</div></div>`))).toBe("material-outside-region");
	});

	it("keeps a short standfirst, link text and a linked directory outside the region", () => {
		const related = [1, 2, 3].map((n) => `<li><a href="/r/${n}">More</a> ${words(`r${n}`, 10)}</li>`).join("");
		const outside = `<p>${words("stand", 30)}</p><p><a href="/x">${words("link", 20)}</a> tail</p><ul>${related}</ul>`;
		expect(unitCount(regionOf(`<div>${outside}<div>${SECTIONS}</div></div>`))).toBe(3);
	});

	it("looks for outside prose only inside the landmark that holds the article", () => {
		const inLandmark = `<main><div id="sections">${SECTIONS}</div></main><div>${words("foot", 60)}</div>`;
		expect(unitCount(regionOf(inLandmark))).toBe(3);
	});

	it("takes the outermost of nested landmarks", () => {
		const nested = `<main><p>${words("lede", 60)}</p><article><div>${SECTIONS}</div></article></main>`;
		expect(unitCount(regionOf(nested))).toBe("material-outside-region");
	});
});
