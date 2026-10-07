import assert from "node:assert/strict";
import { CandidateIdSchema } from "../article/article.schema";
import { summaryMatchesCanonical } from "./content-selection.types";

const candidateId = CandidateIdSchema.parse("candidate");

describe("summaryMatchesCanonical", () => {
	it.each([
		{ candidateId: undefined, summarySourceContentHash: undefined, canonicalContentHash: undefined, matches: true },
		{ candidateId: undefined, summarySourceContentHash: "legacy-hash", canonicalContentHash: undefined, matches: true },
		{ candidateId: undefined, summarySourceContentHash: undefined, canonicalContentHash: "current-hash", matches: true },
		{ candidateId: undefined, summarySourceContentHash: "current-hash", canonicalContentHash: "current-hash", matches: true },
		{ candidateId: undefined, summarySourceContentHash: "old-hash", canonicalContentHash: "current-hash", matches: false },
		{ candidateId, summarySourceContentHash: "current-hash", canonicalContentHash: "current-hash", matches: true },
		{ candidateId, summarySourceContentHash: "old-hash", canonicalContentHash: "current-hash", matches: false },
		{ candidateId, summarySourceContentHash: undefined, canonicalContentHash: "current-hash", matches: false },
		{ candidateId, summarySourceContentHash: undefined, canonicalContentHash: undefined, matches: false },
	])("%j", ({ matches, ...params }) => {
		assert.equal(summaryMatchesCanonical(params), matches);
	});
});
