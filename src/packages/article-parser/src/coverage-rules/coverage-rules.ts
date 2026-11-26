import { parseHTML } from "linkedom";
import type { CoverageRuleModes } from "@packages/domain/article";
import type {
	ActiveCoverageRules,
	CoverageRule,
	RegisteredCoverageRule,
	SourceInspection,
} from "./coverage-rule.types";
import { projectReaderHtml } from "./reader-projection";
import { sectionCoverageRule } from "./section-coverage-rule";

export function bindCoverageRule<Evidence>(rule: CoverageRule<Evidence>): RegisteredCoverageRule {
	return {
		id: rule.id,
		version: rule.version,
		inspect: (source) => {
			const inspected = rule.inspect(source);
			if (inspected.kind === "abstain") {
				return { kind: "abstained", reason: inspected.reason };
			}
			const { evidence } = inspected;
			const recovered = rule.recover?.({ evidence, document: source.document, documentUrl: source.documentUrl });
			return {
				kind: "inspected",
				verify: (reader) => rule.verify({ evidence, reader }),
				recoveredBodyHtml: recovered?.bodyHtml,
			};
		},
	};
}

export function initArticleCoverageRules(): readonly RegisteredCoverageRule[] {
	return [bindCoverageRule(sectionCoverageRule)];
}

export function activateCoverageRules(params: {
	rules: readonly RegisteredCoverageRule[];
	modes: CoverageRuleModes;
}): ActiveCoverageRules {
	const active = params.rules.flatMap((rule) => {
		const mode = params.modes[rule.id];
		return mode === "off" ? [] : [{ rule, mode }];
	});
	return {
		inspect: ({ html, documentUrl }) => {
			if (active.length === 0) {
				return [];
			}
			const { document } = parseHTML(html);
			return active.map(({ rule, mode }) => inspectWithRule({ rule, mode, document, documentUrl }));
		},
	};
}

function inspectWithRule(params: {
	rule: RegisteredCoverageRule;
	mode: "shadow" | "enforce";
	document: Document;
	documentUrl: string;
}): SourceInspection {
	const { rule, mode } = params;
	const assessed = { ruleId: rule.id, ruleVersion: rule.version, mode };
	const inspected = rule.inspect({ document: params.document, documentUrl: params.documentUrl });
	if (inspected.kind === "abstained") {
		return { ...assessed, kind: "abstained", reason: inspected.reason };
	}
	const { verify, recoveredBodyHtml } = inspected;
	return {
		...assessed,
		kind: "inspected",
		verify: ({ readerHtml, media }) => verify(projectReaderHtml({ html: readerHtml, media })),
		recoveredBodyHtml,
	};
}
