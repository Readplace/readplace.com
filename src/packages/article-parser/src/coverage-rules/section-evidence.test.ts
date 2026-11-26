import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { buildSectionEvidence } from "./section-evidence";
import { inspectRegion, type SectionUnit } from "./section-region";

const PAGE = "https://example.com/guide";

function unitsOf(bodyHtml: string): readonly SectionUnit[] {
	const { document } = parseHTML(`<!DOCTYPE html><html><head></head><body>${bodyHtml}</body></html>`);
	return [...document.body.children].map((el) => ({ nodes: [el], leading: false }));
}

describe("buildSectionEvidence on the real captures", () => {
	it.each([
		["coverage-psn-control.html", "https://psnprofiles.com/guide/16422-silent-hill-f-trophy-guide", 14, 0],
		["coverage-psn-silent-hill.html", "https://psnprofiles.com/guide/16422-silent-hill-f-trophy-guide", 7, 0],
		["coverage-git-rebase.html", "https://git-scm.com/docs/git-rebase", 16, 37],
	])("probes every unit of %s", (name, documentUrl, units, code) => {
		const html = readFileSync(join(__dirname, "..", "fixtures", name), "utf8");
		const region = inspectRegion({ document: parseHTML(html).document, documentUrl });
		const evidence = region.kind === "region" ? buildSectionEvidence({ units: region.units, documentUrl }) : undefined;
		expect(evidence?.units).toBe(units);
		expect(evidence?.code.length).toBe(code);
		const probed = new Set([
			...(evidence?.unique ?? []).map((probe) => probe.unit),
			...(evidence?.repeated ?? []).flatMap((probe) => probe.units),
			...(evidence?.code ?? []).map((probe) => probe.unit),
			...(evidence?.cells ?? []).map((probe) => probe.unit),
			...(evidence?.images ?? []).map((probe) => probe.unit),
		]);
		expect(probed.size).toBe(units);
	});
});

describe("buildSectionEvidence", () => {
	it("takes a unique key per run, in source order", () => {
		const evidence = buildSectionEvidence({
			units: unitsOf("<section><p>alpha beta gamma</p></section><section><p>delta epsilon</p><p>one</p></section>"),
			documentUrl: PAGE,
		});
		expect(evidence).toEqual({
			units: 2,
			unique: [
				{ unit: 0, order: 0, key: "alpha beta gamma", fullWindow: false },
				{ unit: 1, order: 1, key: "delta epsilon", fullWindow: false },
			],
			repeated: [],
			code: [],
			cells: [],
			images: [],
		});
	});

	it("falls back from the middle window to the last and the first", () => {
		const shared = "a1 a2 a3 a4 a5 a6 a7 a8 a9 a10 a11 a12";
		const evidence = buildSectionEvidence({
			units: unitsOf(
				`<section><p>${shared} z1</p></section><section><p>q1 q2 q3 q4 ${shared}</p></section><section><p>${shared}</p></section>`,
			),
			documentUrl: PAGE,
		});
		expect(evidence.unique.map((probe) => probe.key)).toEqual(["a6 a7 a8 a9 a10 a11 a12 z1", "q1 q2 q3 q4 a1 a2 a3 a4"]);
		expect(evidence.repeated).toEqual([{ key: "a3 a4 a5 a6 a7 a8 a9 a10", units: [2], count: 3 }]);
	});

	it("groups a preamble shared by every unit into one repeated probe with its source count", () => {
		const preamble = "まず設定画面を開いてから次の手順に進んでください";
		const units = [1, 2, 3]
			.map((n) => `<section><p>${preamble}</p><p>instruction number ${n} words</p></section>`)
			.join("");
		const evidence = buildSectionEvidence({ units: unitsOf(units), documentUrl: PAGE });
		expect(evidence.repeated).toEqual([{ key: "を開いてから次の手順に進", units: [0, 1, 2], count: 3 }]);
		expect(evidence.unique).toHaveLength(3);
	});

	it("probes code, table associations and images, and never headings", () => {
		const evidence = buildSectionEvidence({
			units: unitsOf(
				"<section><h2>Heading only words here</h2><pre>git rebase -i</pre>" +
					"<table><tr><th>Name</th><th>Value</th></tr><tr><td>k</td><td>v</td></tr></table>" +
					'<img src="/map.png"></section><section><pre>git rebase --continue</pre></section>',
			),
			documentUrl: PAGE,
		});
		expect(evidence.code).toEqual([
			{ unit: 0, order: 0, key: "git rebase -i" },
			{ unit: 1, order: 1, key: "git rebase --continue" },
		]);
		expect(evidence.cells).toEqual([{ unit: 0, triple: "k\u0000value\u0000v" }]);
		expect(evidence.images).toEqual([{ unit: 0, urls: ["https://example.com/map.png"] }]);
		expect(evidence.unique).toEqual([]);
	});

	it("drops a unit without probes from the count and numbers the rest consecutively", () => {
		const evidence = buildSectionEvidence({
			units: unitsOf("<section><h3>Note</h3><p>x</p></section><section><p>kept run</p></section>"),
			documentUrl: PAGE,
		});
		expect(evidence.units).toBe(1);
		expect(evidence.unique).toEqual([{ unit: 0, order: 0, key: "kept run", fullWindow: false }]);
	});
});
