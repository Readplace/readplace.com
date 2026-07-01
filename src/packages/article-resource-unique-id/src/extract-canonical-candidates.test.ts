import { parseHTML } from "linkedom";
import { extractCanonicalCandidates } from "./extract-canonical-candidates";

/* The extractor runs against both the browser DOM (extension/tier-0) and
 * linkedom's document (server crawl/tier-1); linkedom exercises the real
 * querySelector/getAttribute path used server-side. */
function candidatesOf(html: string) {
	const { document } = parseHTML(html);
	return extractCanonicalCandidates(document);
}

describe("extractCanonicalCandidates", () => {
	it("reads the rel=canonical href", () => {
		expect(
			candidatesOf('<html><head><link rel="canonical" href="https://x.com/a"></head></html>'),
		).toEqual({ linkCanonicalHref: "https://x.com/a", ogUrl: undefined });
	});

	it("reads the og:url content", () => {
		expect(
			candidatesOf('<html><head><meta property="og:url" content="https://x.com/a"></head></html>'),
		).toEqual({ linkCanonicalHref: undefined, ogUrl: "https://x.com/a" });
	});

	it("reads both when both are present", () => {
		expect(
			candidatesOf(
				'<html><head><link rel="canonical" href="https://x.com/c"><meta property="og:url" content="https://x.com/o"></head></html>',
			),
		).toEqual({ linkCanonicalHref: "https://x.com/c", ogUrl: "https://x.com/o" });
	});

	it("returns undefined for absent tags and for a canonical link with no href", () => {
		expect(candidatesOf("<html><head></head></html>")).toEqual({
			linkCanonicalHref: undefined,
			ogUrl: undefined,
		});
		expect(candidatesOf('<html><head><link rel="canonical"></head></html>')).toEqual({
			linkCanonicalHref: undefined,
			ogUrl: undefined,
		});
	});
});
