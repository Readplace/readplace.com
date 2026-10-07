import { type CandidateId, CandidateIdSchema, SaveAttemptIdSchema } from "@packages/domain/article";
import { chooseTiedCandidate } from "./resolve-tie";
import { candidateProvenance } from "./candidate-provenance";
import type { VerifiedTierSource } from "./tier-source.types";

const cid = (id: string) => CandidateIdSchema.parse(id);

function source({ tier, id, html = "<p>Article</p>", sourceUrl = "https://example.com/a" }: { tier: VerifiedTierSource["tier"]; id: string; html?: string; sourceUrl?: string }): VerifiedTierSource {
	return {
		tier, html,
		metadata: { ...candidateProvenance({
			metadata: { title: "Article", siteName: "example.com", excerpt: "", wordCount: 100, estimatedReadTime: 1 },
			html, evaluationHtml: html, attemptId: SaveAttemptIdSchema.parse(id), originalUrl: "https://example.com/a", sourceUrl,
			kind: tier === "tier-0" ? "extension" : tier === "tier-1" ? "live" : "wrapper", fetchedAt: "2026-10-05T00:00:00.000Z",
		}), id: cid(id) },
	};
}

const extension = source({ tier: "tier-0", id: "extension" });
const live = source({ tier: "tier-1", id: "live" });
const archive = source({ tier: "tier-2", id: "archive", sourceUrl: "https://archive.ph/abc12" });
const defaults = { canonicalId: undefined, freshIds: new Set<CandidateId>(), canonicalNeedsRetry: false };

describe("chooseTiedCandidate", () => {
	it.each([
		[undefined, "live"], [cid("live"), "live"], [cid("archive"), "live"], [cid("extension"), "extension"],
	])("preserves live-over-archive and extension canonical rules with canonical %s", (canonicalId, expected) => {
		expect(chooseTiedCandidate({ ...defaults, sources: [archive, extension, live], canonicalId })?.metadata.id).toBe(expected);
	});

	it("prefers a fresh live candidate when a cached archive ties multiple live candidates", () => {
		const fresh = source({ tier: "tier-1", id: "fresh-live" });
		expect(chooseTiedCandidate({ ...defaults, sources: [archive, live, fresh], canonicalId: cid("archive"), freshIds: new Set([cid("fresh-live")]) })).toBe(fresh);
	});

	it.each(["https://archive.ph/abc12", "https://archive.ph/unrecognized/wrapper", "https://twitter.com/intent/tweet?url=https%3A%2F%2Fexample.com%2Fa"])("treats an extension capture taken on %s as a wrapper tie candidate", (sourceUrl) => {
		const wrapperExtension = source({ tier: "tier-0", id: "wrapper-extension", sourceUrl });
		expect(chooseTiedCandidate({ ...defaults, sources: [wrapperExtension, live], canonicalId: cid("wrapper-extension") })).toBe(live);
	});

	it("uses a fresh extension or live capture when their media changes on an otherwise equal article", () => {
		const old = source({ tier: "tier-0", id: "old", html: '<p>Article</p><img src="https://cdn/old.png">' });
		const fresh = source({ tier: "tier-1", id: "fresh", html: '<p>Article</p><img src="https://cdn/new.png">' });
		expect(chooseTiedCandidate({ ...defaults, sources: [old, fresh, archive], canonicalId: cid("old"), freshIds: new Set([cid("fresh")]) })).toBe(fresh);
	});

	it("retains a healthy canonical when media differ but none of the tied non-archive candidates is fresh", () => {
		const old = source({ tier: "tier-0", id: "old", html: '<img src="https://cdn/old.png">' });
		expect(chooseTiedCandidate({ ...defaults, sources: [old, live, archive], canonicalId: cid("old"), freshIds: new Set([cid("archive")]) })).toBe(old);
	});

	it("ignores archive image rewriting when retaining an extension canonical", () => {
		const extensionImage = source({ tier: "tier-0", id: "extension", html: '<img src="https://cdn/image.png">' });
		const liveImage = source({ tier: "tier-1", id: "live", html: '<img src="https://cdn/image.png">' });
		const archiveImage = source({ tier: "tier-2", id: "archive", html: '<img src="https://archive.ph/image.png">' });
		expect(chooseTiedCandidate({ ...defaults, sources: [extensionImage, liveImage, archiveImage], canonicalId: cid("extension"), freshIds: new Set([cid("archive")]) })).toBe(extensionImage);
	});

	it("retries a too-short canonical with the live candidate", () => {
		expect(chooseTiedCandidate({ ...defaults, sources: [extension, live], canonicalId: cid("extension"), canonicalNeedsRetry: true })).toBe(live);
	});

	it("defaults to fresh live, then extension, then the existing archive, then the first archive", () => {
		const fresh = source({ tier: "tier-1", id: "fresh" });
		expect(chooseTiedCandidate({ ...defaults, sources: [extension, live, fresh], freshIds: new Set([cid("fresh")]) })).toBe(fresh);
		expect(chooseTiedCandidate({ ...defaults, sources: [archive, extension] })).toBe(extension);
		const newerArchive = source({ tier: "tier-2", id: "newer-archive" });
		expect(chooseTiedCandidate({ ...defaults, sources: [archive, newerArchive], canonicalId: cid("newer-archive") })).toBe(newerArchive);
		expect(chooseTiedCandidate({ ...defaults, sources: [archive, newerArchive] })).toBe(archive);
		expect(chooseTiedCandidate({ ...defaults, sources: [] })).toBeUndefined();
	});
});
