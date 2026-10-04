import { ARCHIVE_TIER, ContentTierSchema, KNOWN_TIERS } from "./content-tier";

describe("content tiers", () => {
	it("lists the extension capture, the live crawl and the archive capture", () => {
		expect(KNOWN_TIERS).toEqual(["tier-0", "tier-1", "tier-2"]);
	});

	it("names the archive capture as one of the known tiers", () => {
		expect(ContentTierSchema.parse(ARCHIVE_TIER)).toBe("tier-2");
	});
});
