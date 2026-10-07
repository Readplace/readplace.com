import type { CanonicalCommit, ContentSelectionSnapshot } from "@packages/domain/article-aggregate";

export function prepareSelectionCondition(snapshot: ContentSelectionSnapshot | undefined): { conditions: string[]; values: Record<string, unknown> } {
	const values: Record<string, unknown> = {};
	const conditions: string[] = [];
	const expectedFields = {
		contentSelectionRevision: snapshot?.revision,
		contentLocation: snapshot?.contentLocation,
		displayUrl: snapshot?.displayUrl,
		contentSourceUrl: snapshot?.contentSourceUrl,
		sourceOriginalUrl: snapshot?.sourceOriginalUrl,
	};
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
