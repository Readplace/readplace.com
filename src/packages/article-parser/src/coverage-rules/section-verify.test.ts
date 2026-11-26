import type { SectionEvidence } from "./section-evidence";
import { projectReaderHtml } from "./reader-projection";
import { readerBlocks, verifySection } from "./section-verify";

const NONE: SectionEvidence = { units: 3, unique: [], repeated: [], code: [], cells: [], images: [] };
const MAP = "https://example.com/map.png";

function verify(params: { evidence: Partial<SectionEvidence>; html: string; media?: ReadonlyMap<string, string> }) {
	return verifySection({
		evidence: { ...NONE, ...params.evidence },
		reader: projectReaderHtml({ html: params.html, media: params.media ?? new Map() }),
	});
}

const unique = [
	{ unit: 0, order: 0, key: "alpha beta gamma", fullWindow: false },
	{ unit: 1, order: 1, key: "delta epsilon zeta", fullWindow: false },
	{ unit: 2, order: 2, key: "eta theta iota", fullWindow: false },
];

describe("readerBlocks", () => {
	it("walks everything inside the projection root", () => {
		expect(readerBlocks(projectReaderHtml({ html: "<p>One two</p>", media: new Map() }))).toEqual([{ kind: "text", text: "One two" }]);
	});
});

describe("verifySection", () => {
	it("verifies the article when every probe is found in order", () => {
		expect(verify({ evidence: { unique }, html: "<p>Alpha beta gamma.</p><p>Delta, epsilon zeta</p><p>eta theta iota</p>" })).toEqual({
			outcome: "verified-for-scope",
			scope: { kind: "article", units: 3 },
			covered: 3,
		});
	});

	it("reports a missing run as a missing section", () => {
		expect(verify({ evidence: { unique }, html: "<p>alpha beta gamma</p><p>eta theta iota</p>" })).toEqual({
			outcome: "known-partial",
			scope: { kind: "article", units: 3 },
			covered: 2,
			unresolved: 1,
			reasons: ["missing-section"],
		});
	});

	it("reports a run found only before the previous one as out of order", () => {
		expect(verify({ evidence: { unique }, html: "<p>delta epsilon zeta</p><p>alpha beta gamma</p><p>eta theta iota</p>" })).toMatchObject({
			outcome: "known-partial",
			unresolved: 1,
			reasons: ["section-out-of-order"],
		});
	});

	it("reports a full-window run found twice as duplicated, and ignores a repeated short run", () => {
		const evidence = {
			unique: [
				{ unit: 0, order: 0, key: "w1 w2 w3 w4 w5 w6 w7 w8", fullWindow: true },
				{ unit: 1, order: 1, key: "short run", fullWindow: false },
			],
		};
		const html = "<p>w1 w2 w3 w4 w5 w6 w7 w8</p><p>short run</p><p>w1 w2 w3 w4 w5 w6 w7 w8</p><p>short run</p>";
		expect(verify({ evidence, html })).toMatchObject({ covered: 2, unresolved: 1, reasons: ["duplicated-section"] });
	});

	it("fails every unit of a repeated run the reader holds fewer times than the source", () => {
		const evidence = { repeated: [{ key: "shared preamble", units: [0, 2], count: 3 }] };
		expect(verify({ evidence, html: "<p>shared preamble</p><p>shared preamble</p><p>shared preamble</p>" })).toMatchObject({
			outcome: "verified-for-scope",
		});
		expect(verify({ evidence, html: "<p>shared preamble</p><p>shared preamble</p>" })).toMatchObject({
			covered: 1,
			unresolved: 2,
			reasons: ["missing-section"],
		});
	});

	it("matches code blocks in order", () => {
		const evidence = {
			code: [
				{ unit: 0, order: 0, key: "git rebase -i" },
				{ unit: 1, order: 1, key: "git commit" },
			],
		};
		expect(verify({ evidence, html: "<pre>git rebase -i</pre><pre>git commit</pre>" })).toMatchObject({ outcome: "verified-for-scope" });
		expect(verify({ evidence, html: "<pre>git commit</pre><pre>git rebase -i</pre>" })).toMatchObject({
			unresolved: 1,
			reasons: ["missing-code"],
		});
	});

	it("checks each table value against its row and column", () => {
		const evidence = { cells: [{ unit: 0, triple: "north\u0000count\u000012" }] };
		const table = (north: string, south: string) =>
			`<table><tr><th>Area</th><th>Count</th></tr><tr><td>North</td><td>${north}</td></tr><tr><td>South</td><td>${south}</td></tr></table>`;
		expect(verify({ evidence, html: table("12", "7") })).toMatchObject({ outcome: "verified-for-scope" });
		expect(verify({ evidence, html: table("7", "12") })).toMatchObject({ reasons: ["table-mismatch"] });
	});

	it("accepts an image at its origin url or at its mirrored url", () => {
		const evidence = { images: [{ unit: 1, urls: [MAP] }] };
		expect(verify({ evidence, html: `<img src="${MAP}">` })).toMatchObject({ outcome: "verified-for-scope" });
		expect(
			verify({ evidence, html: '<img src="https://cdn.example.com/m.png">', media: new Map([[MAP, "https://cdn.example.com/m.png"]]) }),
		).toMatchObject({ outcome: "verified-for-scope" });
		expect(verify({ evidence, html: '<img src="https://cdn.example.com/m.png">' })).toMatchObject({ reasons: ["missing-image"] });
	});

	it("counts a unit once however many probes fail in it, and lists distinct reasons sorted", () => {
		const evidence = {
			unique: [{ unit: 0, order: 0, key: "alpha beta gamma", fullWindow: false }],
			images: [{ unit: 0, urls: [MAP] }],
			code: [{ unit: 0, order: 0, key: "make" }],
		};
		expect(verify({ evidence, html: "<p>nothing</p>" })).toEqual({
			outcome: "known-partial",
			scope: { kind: "article", units: 3 },
			covered: 2,
			unresolved: 1,
			reasons: ["missing-code", "missing-image", "missing-section"],
		});
	});
});
