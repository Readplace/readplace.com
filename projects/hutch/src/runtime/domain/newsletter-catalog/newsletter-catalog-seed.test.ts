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
				{ from: "enewsletter@scottishnews.com", name: "Scottish Legal News", evidence: 1 },
				{ from: "newsletter@energyandcapital.com", name: "Energy & Capital", evidence: 1 },
				{ from: "hello@cgxapp.com", name: "CGX", evidence: 1 },
				{ from: "briefs@dailydosebriefs.com", name: "Daily Dose", evidence: 1 },
				{ from: "googlealerts-noreply@google.com", name: "Google Alerts", evidence: 1 },
				{ from: "newsletter.email@businessinsider.com", name: "Business Insider", evidence: 1 },
				{ from: "newsletters@analystratings.net", name: "MarketBeat", evidence: 1 },
				{ from: "oxford@mp.oxfordclub.com", name: "The Oxford Club", evidence: 1 },
				{ from: "dr@email.paradigmpressgroup.com", name: "The Daily Reckoning", evidence: 1 },
				{ from: "dailyproof@email.paradigmpressgroup.com", name: "The Daily Reckoning", evidence: 1 },
				{ from: "dailyfwd@email.paradigmpressgroup.com", name: "The Daily Reckoning", evidence: 1 },
				{ from: "info@mp.paradigmpressgroup.com", name: "Paradigm Press", evidence: 1 },
				{ from: "info@mb.paradigmpressgroup.com", name: "Paradigm Press", evidence: 1 },
				{ from: "vip@mb.paradigmpressgroup.com", name: "Paradigm Press", evidence: 1 },
				{ from: "jsw@peterc.org", name: "JavaScript Weekly", evidence: 1 },
				{ from: "jakub@programmingdigest.net", name: "Programming Digest", evidence: 1 },
				{ from: "jakub@mail.leadershipintech.com", name: "Leadership in Tech", evidence: 1 },
				{ from: "anton@newsletter.manager.dev", name: "Manager.dev", evidence: 1 },
				{ from: "mamund@substack.com", name: "Signals from Our Futures Past", evidence: 1 },
			],
		);
	});
});
