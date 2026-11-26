import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { resolveRelativeUrls } from "../resolve-relative-urls";
import type { CoverageInspection, SourceInspection } from "./coverage-rule.types";
import { activateCoverageRules, initArticleCoverageRules } from "./coverage-rules";
import { planCoverageRepair } from "./plan-coverage-repair";

const PSN = "https://psnprofiles.com/guide/16422-silent-hill-f-trophy-guide";
const GIT = "https://git-scm.com/docs/git-rebase";

function fixture(name: string): string {
	return readFileSync(join(__dirname, "..", "fixtures", name), "utf-8");
}

function inspected(params: { html: string; documentUrl: string; mode?: "shadow" | "enforce" }) {
	const rules = activateCoverageRules({
		rules: initArticleCoverageRules(),
		modes: { "section-coverage": params.mode ?? "shadow" },
	});
	const [inspection] = rules.inspect({ html: params.html, documentUrl: params.documentUrl });
	assert(inspection.kind === "inspected", JSON.stringify(inspection));
	assert(inspection.recoveredBodyHtml !== undefined);
	return { ...inspection, recovered: resolveRelativeUrls({ html: inspection.recoveredBodyHtml, baseUrl: params.documentUrl }) };
}

function readabilityBaseline(params: { html: string; documentUrl: string }): string {
	const parsed = new Readability(parseHTML(params.html).document).parse();
	assert(parsed?.content);
	return resolveRelativeUrls({ html: parsed.content, baseUrl: params.documentUrl });
}

function verifyAgainst(params: { inspection: SourceInspection; readerHtml: string }) {
	assert(params.inspection.kind === "inspected");
	return params.inspection.verify({ readerHtml: params.readerHtml, media: new Map() });
}

function inOrder(params: { html: string; needles: readonly string[] }): boolean {
	const text = parseHTML(`<div>${params.html}</div>`).document.documentElement.textContent ?? "";
	const positions = params.needles.map((needle) => text.indexOf(needle));
	return positions.every((position, i) => position >= 0 && (i === 0 || position > positions[i - 1]));
}

function renameClassesAndIds(html: string): string {
	const { document } = parseHTML(html);
	const ids = new Map<string, string>();
	const renamed = (map: Map<string, string>, value: string) => {
		const known = map.get(value);
		if (known !== undefined) {
			return known;
		}
		const fresh = `r${map.size}x`;
		map.set(value, fresh);
		return fresh;
	};
	const classes = new Map<string, string>();
	for (const element of document.querySelectorAll("*")) {
		const id = element.getAttribute("id");
		if (id) {
			element.setAttribute("id", renamed(ids, id));
		}
		const className = element.getAttribute("class");
		if (className) {
			element.setAttribute("class", className.split(/\s+/).filter(Boolean).map((name) => renamed(classes, name)).join(" "));
		}
		const name = element.tagName === "A" ? element.getAttribute("name") : null;
		if (name) {
			element.setAttribute("name", renamed(ids, name));
		}
	}
	for (const anchor of document.querySelectorAll('a[href^="#"]')) {
		const target = anchor.getAttribute("href")?.slice(1) ?? "";
		anchor.setAttribute("href", `#${renamed(ids, target)}`);
	}
	return document.toString();
}

function asPlanned(inspection: ReturnType<typeof inspected>): CoverageInspection {
	return {
		ruleId: inspection.ruleId,
		ruleVersion: inspection.ruleVersion,
		mode: inspection.mode,
		kind: "inspected",
		verify: inspection.verify,
		alternative: () => ({ content: inspection.recovered, wordCount: 0 }),
	};
}

describe("section-coverage rule on real captures", () => {
	const control = fixture("coverage-psn-control.html");
	const controlTitles = [...parseHTML(control).document.querySelectorAll("#sections > .section-holder .title")].map(
		(title) => title.textContent?.trim() ?? "",
	);

	it("the PSNProfiles control: Readability loses every section, the recovered body holds all 14 in order", () => {
		const inspection = inspected({ html: control, documentUrl: PSN });
		const baseline = verifyAgainst({ inspection, readerHtml: readabilityBaseline({ html: control, documentUrl: PSN }) });
		assert(baseline.outcome === "known-partial");
		expect(baseline.unresolved).toBeGreaterThanOrEqual(13);
		expect(verifyAgainst({ inspection, readerHtml: inspection.recovered })).toEqual({
			outcome: "verified-for-scope",
			scope: { kind: "article", units: 14 },
			covered: 14,
		});
		expect(controlTitles).toHaveLength(14);
		expect(inOrder({ html: inspection.recovered, needles: controlTitles })).toBe(true);
	});

	it("S15 (control with every class and id renamed) reaches the same outcomes", () => {
		const renamed = renameClassesAndIds(control);
		expect(renamed).not.toContain("section-holder");
		const inspection = inspected({ html: renamed, documentUrl: PSN });
		const baseline = verifyAgainst({ inspection, readerHtml: readabilityBaseline({ html: renamed, documentUrl: PSN }) });
		assert(baseline.outcome === "known-partial");
		expect(baseline.unresolved).toBeGreaterThanOrEqual(13);
		expect(verifyAgainst({ inspection, readerHtml: inspection.recovered })).toMatchObject({ outcome: "verified-for-scope", covered: 14 });
	});

	it("R1 (control without its middle section): verifies 13 of 13, and the original evidence does not certify it", () => {
		const { document } = parseHTML(control);
		const holders = document.querySelectorAll("#sections > .section-holder");
		holders[7].remove();
		const trimmed = document.toString();
		const r1 = inspected({ html: trimmed, documentUrl: PSN });
		expect(verifyAgainst({ inspection: r1, readerHtml: r1.recovered })).toEqual({
			outcome: "verified-for-scope",
			scope: { kind: "article", units: 13 },
			covered: 13,
		});
		expect(verifyAgainst({ inspection: inspected({ html: control, documentUrl: PSN }), readerHtml: r1.recovered })).toMatchObject({
			outcome: "known-partial",
			reasons: expect.arrayContaining(["missing-section"]),
		});
	});

	it("the Silent Hill f guide: Readability keeps one section, the recovered body holds all 7", () => {
		const html = fixture("coverage-psn-silent-hill.html");
		const inspection = inspected({ html, documentUrl: PSN });
		expect(verifyAgainst({ inspection, readerHtml: readabilityBaseline({ html, documentUrl: PSN }) })).toMatchObject({
			outcome: "known-partial",
			covered: 1,
			unresolved: 6,
		});
		expect(verifyAgainst({ inspection, readerHtml: inspection.recovered })).toEqual({
			outcome: "verified-for-scope",
			scope: { kind: "article", units: 7 },
			covered: 7,
		});
	});

	describe("the git-rebase manual", () => {
		const html = fixture("coverage-git-rebase.html");

		it("the last pre is a code probe: a reader missing only that block reads missing-code", () => {
			const inspection = inspected({ html, documentUrl: GIT });
			const { document } = parseHTML(`<div id="root">${inspection.recovered}</div>`);
			const pres = [...document.querySelectorAll("pre")];
			pres[pres.length - 1].remove();
			const outcome = verifyAgainst({ inspection, readerHtml: document.getElementById("root")?.innerHTML ?? "" });
			assert(outcome.outcome === "known-partial");
			expect(outcome.reasons).toContain("missing-code");
		});

		it("Readability loses the code blocks, the recovered body holds all 16 sections and every pre", () => {
			const inspection = inspected({ html, documentUrl: GIT });
			const baseline = verifyAgainst({ inspection, readerHtml: readabilityBaseline({ html, documentUrl: GIT }) });
			assert(baseline.outcome === "known-partial");
			expect(baseline.reasons).toContain("missing-code");
			expect(verifyAgainst({ inspection, readerHtml: inspection.recovered })).toEqual({
				outcome: "verified-for-scope",
				scope: { kind: "article", units: 16 },
				covered: 16,
			});
			const recovered = parseHTML(`<div>${inspection.recovered}</div>`).document;
			expect(recovered.querySelectorAll("pre").length).toBe(37);
			const headings = [...recovered.querySelectorAll("h2")].map((h2) => h2.textContent?.trim());
			expect(headings.filter((heading) => ["INTERACTIVE MODE", "REBASING MERGES", "CONFIGURATION"].includes(heading ?? ""))).toEqual([
				"INTERACTIVE MODE",
				"REBASING MERGES",
				"CONFIGURATION",
			]);
		});

		it("R2 (git-rebase with the SPLITTING COMMITS steps reordered) is out of order", () => {
			const inspection = inspected({ html, documentUrl: GIT });
			const { document } = parseHTML(`<div id="root">${inspection.recovered}</div>`);
			const heading = [...document.querySelectorAll("h2")].find((h2) => h2.textContent?.trim() === "SPLITTING COMMITS");
			const [first, second] = [...(heading?.parentElement?.querySelectorAll("li") ?? [])];
			assert(first && second);
			second.after(first);
			const root = document.querySelector("#root");
			assert(root);
			expect(verifyAgainst({ inspection, readerHtml: root.innerHTML })).toMatchObject({
				outcome: "known-partial",
				reasons: expect.arrayContaining(["section-out-of-order"]),
			});
		});
	});

	it("planCoverageRepair offers the recovered control in enforce mode only", () => {
		const baselineContent = readabilityBaseline({ html: control, documentUrl: PSN });
		const shadow = planCoverageRepair({
			baselineContent,
			inspections: [asPlanned(inspected({ html: control, documentUrl: PSN }))],
		});
		expect(shadow.entries[0]).toMatchObject({ wouldRepair: true });
		expect(shadow.repair).toBeUndefined();
		const enforce = planCoverageRepair({
			baselineContent,
			inspections: [asPlanned(inspected({ html: control, documentUrl: PSN, mode: "enforce" }))],
		});
		expect(enforce.repair?.index).toBe(0);
	});
});
