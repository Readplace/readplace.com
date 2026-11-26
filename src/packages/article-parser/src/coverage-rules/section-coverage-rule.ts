import { COVERAGE_RULE_VERSIONS } from "@packages/domain/article";
import type { CoverageRule } from "./coverage-rule.types";
import { buildSectionEvidence, type SectionEvidence } from "./section-evidence";
import { recoverSection } from "./section-recover";
import { inspectRegion } from "./section-region";
import { MIN_UNITS } from "./section-thresholds";
import { verifySection } from "./section-verify";

type SectionCoverageEvidence = { section: SectionEvidence; recoveredBodyHtml: string };

export const sectionCoverageRule: CoverageRule<SectionCoverageEvidence> = {
	id: "section-coverage",
	version: COVERAGE_RULE_VERSIONS["section-coverage"],
	inspect: ({ document, documentUrl }) => {
		const region = inspectRegion({ document, documentUrl });
		if (region.kind === "abstain") {
			return { kind: "abstain", reason: region.reason };
		}
		const section = buildSectionEvidence({ units: region.units, documentUrl });
		if (section.units < MIN_UNITS) {
			return { kind: "abstain", reason: "no-section-structure" };
		}
		return { kind: "evidence", evidence: { section, recoveredBodyHtml: recoverSection({ root: region.root }).bodyHtml } };
	},
	verify: ({ evidence, reader }) => verifySection({ evidence: evidence.section, reader }),
	recover: ({ evidence }) => ({ bodyHtml: evidence.recoveredBodyHtml }),
};
