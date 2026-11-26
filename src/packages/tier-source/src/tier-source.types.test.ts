import { CandidateIdSchema, SaveAttemptIdSchema } from "@packages/domain/article";
import { CandidateProvenanceSchema } from "./tier-source.types";

const manifest = {
	title: "Article", siteName: "Example", excerpt: "", wordCount: 4, estimatedReadTime: 1,
	id: CandidateIdSchema.parse("candidate"), attemptId: SaveAttemptIdSchema.parse("attempt"), contentHash: "hash",
	originalUrl: "https://example.com/post", sourceUrl: "https://example.com/post", kind: "live", fetchedAt: "2026-10-05T00:00:00Z",
};

describe("candidate manifest coverage", () => {
	it("parses a manifest written before coverage existed, with no evidence", () => {
		expect(CandidateProvenanceSchema.parse(manifest).coverage).toBeUndefined();
	});
	it("keeps a manifest whose coverage a newer rule set wrote as a candidate, carrying the evidence unread", () => {
		const coverage = { schemaVersion: 2, assessments: [{ ruleId: "future-rule" }] };
		expect(CandidateProvenanceSchema.parse({ ...manifest, coverage }).coverage).toEqual(coverage);
	});
});
