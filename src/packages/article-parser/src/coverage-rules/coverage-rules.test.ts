import { ALL_COVERAGE_RULES_OFF } from "@packages/domain/article";
import { parseHTML } from "linkedom";
import type { CoverageRule } from "./coverage-rule.types";
import { activateCoverageRules, bindCoverageRule, initArticleCoverageRules } from "./coverage-rules";
import { projectReaderHtml } from "./reader-projection";

const PAGE = { html: "<html><body><p>Source words</p></body></html>", documentUrl: "https://example.com/a" };

function testRule(inspect: CoverageRule<string>["inspect"]): CoverageRule<string> {
	return {
		id: "section-coverage",
		version: 3,
		inspect,
		verify: ({ evidence, reader }) => ({
			outcome: "verified-for-scope",
			scope: { kind: "article", units: 1 },
			covered: reader.document.getElementById("root")?.textContent === evidence ? 1 : 2,
		}),
		recover: ({ evidence }) => ({ bodyHtml: `<p>${evidence}</p>` }),
	};
}

const readsBody: CoverageRule<string>["inspect"] = ({ document }) => ({
	kind: "evidence",
	evidence: document.body.textContent ?? "",
});

describe("activateCoverageRules", () => {
	it("never inspects a rule that is off", () => {
		const inspect = jest.fn(readsBody);
		const active = activateCoverageRules({ rules: [bindCoverageRule(testRule(inspect))], modes: ALL_COVERAGE_RULES_OFF });
		expect(active.inspect(PAGE)).toEqual([]);
		expect(inspect).not.toHaveBeenCalled();
	});

	it.each(["shadow", "enforce"] as const)("inspects a rule in %s with its id, version and mode", (mode) => {
		const active = activateCoverageRules({
			rules: [bindCoverageRule(testRule(readsBody))],
			modes: { "section-coverage": mode },
		});
		const [inspection] = active.inspect(PAGE);
		expect(inspection).toEqual(
			expect.objectContaining({
				ruleId: "section-coverage",
				ruleVersion: 3,
				mode,
				kind: "inspected",
				recoveredBodyHtml: "<p>Source words</p>",
			}),
		);
	});

	it("verifies the reader html as the reader's sanitiser leaves it", () => {
		const active = activateCoverageRules({
			rules: [bindCoverageRule(testRule(readsBody))],
			modes: { "section-coverage": "shadow" },
		});
		const [inspection] = active.inspect(PAGE);
		const verify = (readerHtml: string) =>
			inspection.kind === "inspected" ? inspection.verify({ readerHtml, media: new Map() }) : undefined;
		expect(verify("Source words<script>x</script>")).toEqual(expect.objectContaining({ covered: 1 }));
		expect(verify("Other words")).toEqual(expect.objectContaining({ covered: 2 }));
	});

	it("passes on an abstention", () => {
		const active = activateCoverageRules({
			rules: [bindCoverageRule(testRule(() => ({ kind: "abstain", reason: "off-page-sections" })))],
			modes: { "section-coverage": "enforce" },
		});
		expect(active.inspect(PAGE)).toEqual([
			{ ruleId: "section-coverage", ruleVersion: 3, mode: "enforce", kind: "abstained", reason: "off-page-sections" },
		]);
	});
});


const { document } = parseHTML("<html><body><p>Source</p></body></html>");
const source = { document, documentUrl: "https://example.com/a" };
const reader = projectReaderHtml({ html: "<p>Reader</p>", media: new Map() });

function boundRule(overrides: Partial<CoverageRule<string>>): CoverageRule<string> {
	return {
		id: "section-coverage",
		version: 1,
		inspect: () => ({ kind: "evidence", evidence: "evidence" }),
		verify: ({ evidence, reader: projection }) => ({
			outcome: "unknown",
			reasons: [evidence === "evidence" && projection === reader ? "missing-section" : "rule-failed"],
		}),
		...overrides,
	};
}

describe("bindCoverageRule", () => {
	it("keeps the rule's id and version and passes on an abstention", () => {
		const bound = bindCoverageRule(boundRule({ inspect: () => ({ kind: "abstain", reason: "no-section-structure" }) }));
		expect(bound.id).toBe("section-coverage");
		expect(bound.version).toBe(1);
		expect(bound.inspect(source)).toEqual({ kind: "abstained", reason: "no-section-structure" });
	});

	it("closes over the evidence so verify needs only the reader", () => {
		const inspected = bindCoverageRule(boundRule({})).inspect(source);
		expect(inspected.kind === "inspected" && inspected.verify(reader)).toEqual({ outcome: "unknown", reasons: ["missing-section"] });
		expect(inspected.kind === "inspected" && inspected.recoveredBodyHtml).toBeUndefined();
	});

	it("recovers at once from the source document and evidence", () => {
		const recover = jest.fn(({ evidence, document: doc }: { evidence: string; document: Document }) => ({
			bodyHtml: `${evidence}:${doc.body.textContent}`,
		}));
		const inspected = bindCoverageRule(boundRule({ recover })).inspect(source);
		expect(inspected.kind === "inspected" && inspected.recoveredBodyHtml).toBe("evidence:Source");
		expect(recover).toHaveBeenCalledWith({ evidence: "evidence", document, documentUrl: "https://example.com/a" });
	});

	it("reads no alternative when the rule cannot recover this source", () => {
		const inspected = bindCoverageRule(boundRule({ recover: () => undefined })).inspect(source);
		expect(inspected).toEqual(expect.objectContaining({ kind: "inspected", recoveredBodyHtml: undefined }));
	});
});

describe("initArticleCoverageRules", () => {
	it("registers the section-coverage rule at its current version", () => {
		expect(initArticleCoverageRules().map(({ id, version }) => ({ id, version }))).toEqual([{ id: "section-coverage", version: 1 }]);
	});
});
