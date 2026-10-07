import { z } from "zod";
import { VerificationFields, isUnverifiedWrapperContent } from "./verified-content";

const VerificationRow = z.object(VerificationFields);
const candidateId = "candidate";
const otherCandidateId = "other";

describe("isUnverifiedWrapperContent", () => {
	it.each([
		{ originalUrl: "https://web.archive.org/web/20080101000000/https://example.com/article" },
		{ originalUrl: "https://archive.ph/abc12" },
		{ originalUrl: "https://archive.today/unknown/path" },
		{ originalUrl: "https://javascriptweekly.com/link/100000/rss" },
		{ originalUrl: "https://javascriptweekly.com/link/100000/rss", displayUrl: "https://archive.ph/abc12" },
		{ originalUrl: "https://archive.ph/abc12", displayUrl: "https://example.com/post" },
		{ originalUrl: "https://web.archive.org/web/20080101000000/https://example.com/article", displayUrl: "https://example.com/article" },
		{ contentSourceUrl: "https://archive.today/short" },
		{ originalUrl: "https://example.com/post", contentSourceTier: "tier-1", contentSourceUrl: "https://archive.today/short" },
		{ contentSourceTier: "tier-2" },
		{ contentSourceTier: "tier-2", contentSourceUrl: "https://archive.today/short", directContentBeforePin: true },
		{ canonicalCandidateId: candidateId, canonicalOriginalUrl: "https://example.com/post", revokedCandidateIds: new Set([candidateId]) },
		{ canonicalCandidateId: candidateId, canonicalOriginalUrl: "https://example.com/post", displayUrl: "https://other.example/post" },
	])("withholds %j", (row) => {
		expect(isUnverifiedWrapperContent(VerificationRow.parse(row))).toBe(true);
	});

	it.each([
		{},
		{ originalUrl: "https://example.com/post" },
		{ originalUrl: "https://javascriptweekly.com/link/100000/rss", displayUrl: "https://example.com/post" },
		{ originalUrl: "https://apple.news/AbCdEfGhIjKlMnOpQrStUv", displayUrl: "https://example.com/post" },
		{ originalUrl: "https://example.com/post", contentSourceTier: "tier-1", contentSourceUrl: "https://archive.today/short", directContentBeforePin: true },
		{ originalUrl: "https://example.com/post", canonicalCandidateId: candidateId, canonicalOriginalUrl: "https://example.com/post", revokedCandidateIds: new Set([otherCandidateId]) },
		{ originalUrl: "https://archive.ph/abc12", displayUrl: "https://example.com/post", contentSourceTier: "tier-2", canonicalCandidateId: candidateId, canonicalOriginalUrl: "https://example.com/post" },
		{ contentSourceTier: "tier-2", canonicalCandidateId: candidateId, canonicalOriginalUrl: "https://example.com/post" },
		{ originalUrl: "https://twitter.com/a/status/1", canonicalCandidateId: candidateId, canonicalOriginalUrl: "https://x.com/a/status/1" },
	])("allows %j", (row) => {
		expect(isUnverifiedWrapperContent(VerificationRow.parse(row))).toBe(false);
	});
});
