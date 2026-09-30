import assert from "node:assert/strict";
import { readNewsletterCatalogSeed } from "./newsletter-catalog-seed";

describe("readNewsletterCatalogSeed", () => {
	it("reads every committed seed sender with its evidence", () => {
		const seed = readNewsletterCatalogSeed();

		assert.deepEqual(
			seed.entries.map((entry) => ({
				from: entry.from,
				name: entry.name,
				evidence: entry.evidence.length,
			})),
			[
				{
					from: "enewsletter@scottishnews.com",
					name: "Scottish Legal News",
					evidence: 1,
				},
				{
					from: "newsletter@energyandcapital.com",
					name: "Energy & Capital",
					evidence: 1,
				},
				{ from: "hello@cgxapp.com", name: "CGX", evidence: 1 },
				{ from: "briefs@dailydosebriefs.com", name: "Daily Dose", evidence: 1 },
				{
					from: "pragmaticengineer@substack.com",
					name: "The Pragmatic Engineer",
					evidence: 1,
				},
			],
		);
	});
});
