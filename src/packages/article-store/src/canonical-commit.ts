import type { CanonicalCommit, ContentSelectionSnapshot, SelectionExpected } from "@packages/domain/article-aggregate";

type Condition = { conditions: string[]; values: Record<string, unknown> };

function expectAttributes(expectedFields: Record<string, unknown>): Condition {
	const values: Record<string, unknown> = {};
	const conditions: string[] = [];
	for (const [name, expected] of Object.entries(expectedFields)) {
		if (expected === undefined) {
			conditions.push(`attribute_not_exists(${name})`);
		} else {
			const token = `:expected_${name}`;
			values[token] = expected;
			conditions.push(`${name} = ${token}`);
		}
	}
	return { conditions, values };
}

function prepareSelectionCondition(snapshot: ContentSelectionSnapshot | undefined): Condition {
	return expectAttributes({
		contentSelectionRevision: snapshot?.revision,
		contentLocation: snapshot?.contentLocation,
		displayUrl: snapshot?.displayUrl,
		contentSourceUrl: snapshot?.contentSourceUrl,
		sourceOriginalUrl: snapshot?.sourceOriginalUrl,
	});
}

function prepareCanonicalContentCondition(snapshot: ContentSelectionSnapshot | undefined): Condition {
	const expected = expectAttributes({ canonicalCandidateId: snapshot?.candidateId, contentLocation: snapshot?.contentLocation });
	if (snapshot?.candidateId !== undefined) expected.conditions.push("NOT contains(revokedCandidateIds, :expected_canonicalCandidateId)");
	return expected;
}

export function prepareExpectedSelection(expected: SelectionExpected): Condition {
	return expected.scope === "canonical-content" ? prepareCanonicalContentCondition(expected.snapshot) : prepareSelectionCondition(expected.snapshot);
}

export function prepareCanonicalCommit(commit: CanonicalCommit): {
	sets: string[];
	conditions: string[];
	values: Record<string, unknown>;
} {
	const values: Record<string, unknown> = {
		":contentLocation": commit.contentLocation,
		":candidateId": commit.candidateId,
		":canonicalOriginalUrl": commit.originalUrl,
		":canonicalSourceTier": commit.tier,
		":nextSelectionRevision": (commit.expected?.revision ?? 0) + 1,
	};
	const { conditions, values: expectedValues } = prepareSelectionCondition(commit.expected);
	conditions.push("NOT contains(revokedCandidateIds, :candidateId)");
	Object.assign(values, expectedValues);
	return {
		sets: [
			"contentLocation = :contentLocation",
			"canonicalCandidateId = :candidateId",
			"canonicalOriginalUrl = :canonicalOriginalUrl",
			"contentSourceTier = :canonicalSourceTier",
			"canonicalSourceTier = :canonicalSourceTier",
			"contentSelectionRevision = :nextSelectionRevision",
		],
		conditions,
		values,
	};
}
