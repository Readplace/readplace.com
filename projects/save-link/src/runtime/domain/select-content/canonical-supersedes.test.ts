import { SaveAttemptIdSchema } from "@packages/domain/article";
import { LEGACY_DIRECT_CANONICAL_ATTEMPT_ID, candidateProvenance, type Tier, type VerifiedTierSource } from "@packages/tier-source";
import { canonicalSupersedes } from "./canonical-supersedes";

const URL = "https://example.com/article";
const ARCHIVE = "https://archive.ph/abc12";
const MESSAGE_ATTEMPT = SaveAttemptIdSchema.parse("message-attempt");
const LATER_ATTEMPT = SaveAttemptIdSchema.parse("later-attempt");
const EARLIER = "2026-10-20T00:00:00.000Z";
const LATER = "2026-10-21T00:00:00.000Z";

function candidate(params: { attemptId: typeof MESSAGE_ATTEMPT | typeof LEGACY_DIRECT_CANONICAL_ATTEMPT_ID; fetchedAt: string; tier?: Tier; sourceUrl?: string }): VerifiedTierSource {
	const html = `<p>Body fetched at ${params.fetchedAt}</p>`;
	return {
		tier: params.tier ?? "tier-1", html,
		metadata: candidateProvenance({
			metadata: { title: "Article", siteName: "example.com", excerpt: "", wordCount: 4, estimatedReadTime: 1 },
			html, evaluationHtml: html, attemptId: params.attemptId, originalUrl: URL, sourceUrl: params.sourceUrl ?? URL,
			kind: params.tier === "tier-2" ? "wrapper" : "live", fetchedAt: params.fetchedAt,
		}),
	};
}

describe("canonicalSupersedes", () => {
	const source = candidate({ attemptId: MESSAGE_ATTEMPT, fetchedAt: EARLIER });

	it("returns true when the source is older than a live tier-1 canonical from another attempt", () => {
		expect(canonicalSupersedes({ source, canonical: candidate({ attemptId: LATER_ATTEMPT, fetchedAt: LATER }), saveAttemptId: MESSAGE_ATTEMPT })).toBe(true);
	});

	it("returns false with no canonical", () => {
		expect(canonicalSupersedes({ source, canonical: undefined, saveAttemptId: MESSAGE_ATTEMPT })).toBe(false);
	});

	it("returns false when the canonical is from this attempt", () => {
		expect(canonicalSupersedes({ source, canonical: candidate({ attemptId: MESSAGE_ATTEMPT, fetchedAt: LATER }), saveAttemptId: MESSAGE_ATTEMPT })).toBe(false);
	});

	it("returns false for a legacy canonical", () => {
		expect(canonicalSupersedes({ source, canonical: candidate({ attemptId: LEGACY_DIRECT_CANONICAL_ATTEMPT_ID, fetchedAt: LATER }), saveAttemptId: MESSAGE_ATTEMPT })).toBe(false);
	});

	it("returns false for a tier-2 canonical fetched later", () => {
		expect(canonicalSupersedes({ source, canonical: candidate({ attemptId: LATER_ATTEMPT, fetchedAt: LATER, tier: "tier-2", sourceUrl: ARCHIVE }), saveAttemptId: MESSAGE_ATTEMPT })).toBe(false);
	});

	it("returns false for a wrapper-host tier-1 canonical fetched later", () => {
		expect(canonicalSupersedes({ source, canonical: candidate({ attemptId: LATER_ATTEMPT, fetchedAt: LATER, sourceUrl: ARCHIVE }), saveAttemptId: MESSAGE_ATTEMPT })).toBe(false);
	});

	it("returns false when the source is newer", () => {
		expect(canonicalSupersedes({ source: candidate({ attemptId: MESSAGE_ATTEMPT, fetchedAt: LATER }), canonical: candidate({ attemptId: LATER_ATTEMPT, fetchedAt: EARLIER }), saveAttemptId: MESSAGE_ATTEMPT })).toBe(false);
	});

	it("returns false on an equal fetchedAt", () => {
		expect(canonicalSupersedes({ source, canonical: candidate({ attemptId: LATER_ATTEMPT, fetchedAt: EARLIER }), saveAttemptId: MESSAGE_ATTEMPT })).toBe(false);
	});
});
