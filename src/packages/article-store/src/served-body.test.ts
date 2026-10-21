import { z } from "zod";
import { ServedBodyFields, servedBodyOf } from "./served-body";

const ServedBodyRow = z.object(ServedBodyFields);
const candidateId = "candidate";
const candidateLocation = "s3://content/articles/a/sources/tier-1.html.candidates/aaa/content.html";

function servedBodyOfRow(row: Record<string, unknown>) {
	return servedBodyOf(ServedBodyRow.parse(row));
}

describe("servedBodyOf", () => {
	it.each([
		{ purgedAt: "2026-10-05T00:00:00Z" },
		{ purgedAt: "2026-10-05T00:00:00Z", canonicalCandidateId: candidateId, canonicalOriginalUrl: "https://example.com/post", contentLocation: candidateLocation },
		{ canonicalCandidateId: candidateId, canonicalOriginalUrl: "https://example.com/post", contentLocation: candidateLocation, revokedCandidateIds: new Set([candidateId]) },
		{ originalUrl: "https://archive.today/unknown/path" },
	])("withholds %j", (row) => {
		expect(servedBodyOfRow(row)).toEqual({ kind: "withheld" });
	});

	it.each([
		{ originalUrl: "https://example.com/post" },
		{ originalUrl: "https://example.com/post", contentLocation: "s3://content/content/example.com%2Fpost/content.html" },
	])("serves the legacy body of a row without a committed candidate %j", (row) => {
		expect(servedBodyOfRow(row)).toEqual({ kind: "legacy" });
	});

	it("serves the committed candidate at its content location", () => {
		expect(servedBodyOfRow({
			originalUrl: "https://example.com/post",
			canonicalCandidateId: candidateId,
			canonicalOriginalUrl: "https://example.com/post",
			contentLocation: candidateLocation,
		})).toEqual({ kind: "committed", location: candidateLocation });
	});

	it("rejects a committed candidate without a content location", () => {
		expect(() => servedBodyOfRow({
			originalUrl: "https://example.com/post",
			canonicalCandidateId: candidateId,
			canonicalOriginalUrl: "https://example.com/post",
		})).toThrow("a committed candidate always records its content location");
	});
});
