import { type MailTabCounts, buildMailTabs } from "./mail-tabs";

const EMAIL_ID = "2026-06-24T09:00:00.000Z#<m@x>";
const ENCODED_EMAIL_ID = "2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E";

const NO_COUNTS: MailTabCounts = {};

describe("buildMailTabs", () => {
	it("marks the active tab with aria-current and leaves the others unset", () => {
		const tabs = buildMailTabs({ emailId: EMAIL_ID, active: "view", counts: NO_COUNTS });

		expect(tabs.map((tab) => tab.key)).toEqual(["view", "articles", "excluded"]);
		expect(tabs.map((tab) => tab.label)).toEqual(["View", "Extracted Articles", "Skipped"]);
		expect(tabs[0].ariaCurrent).toBe("page");
		expect(tabs[1].ariaCurrent).toBeUndefined();
		expect(tabs[2].ariaCurrent).toBeUndefined();
	});

	it("moves aria-current to the Articles tab when it is the active one", () => {
		const tabs = buildMailTabs({ emailId: EMAIL_ID, active: "articles", counts: NO_COUNTS });

		expect(tabs[0].ariaCurrent).toBeUndefined();
		expect(tabs[1].ariaCurrent).toBe("page");
		expect(tabs[2].ariaCurrent).toBeUndefined();
	});

	it("moves aria-current to the Skipped tab when it is the active one", () => {
		const tabs = buildMailTabs({ emailId: EMAIL_ID, active: "excluded", counts: NO_COUNTS });

		expect(tabs[0].ariaCurrent).toBeUndefined();
		expect(tabs[1].ariaCurrent).toBeUndefined();
		expect(tabs[2].ariaCurrent).toBe("page");
	});

	it("links every tab to its own URL, carrying the feature flag the surface needs", () => {
		const tabs = buildMailTabs({ emailId: EMAIL_ID, active: "view", counts: NO_COUNTS });

		expect(tabs.map((tab) => tab.href)).toEqual([
			`/inbox/${ENCODED_EMAIL_ID}?feature=email`,
			`/inbox/${ENCODED_EMAIL_ID}?feature=email&tab=articles`,
			`/inbox/${ENCODED_EMAIL_ID}?feature=email&tab=excluded`,
		]);
	});

	it("suffixes each list tab with how many items it holds", () => {
		const tabs = buildMailTabs({
			emailId: EMAIL_ID,
			active: "articles",
			counts: { articles: 12, excluded: 3 },
		});

		expect(tabs.map((tab) => tab.label)).toEqual([
			// The View tab renders the email itself, so it never carries a count.
			"View",
			"Extracted Articles (12)",
			"Skipped (3)",
		]);
	});

	it("shows a zero count so an empty tab reads as 'none', not 'not known yet'", () => {
		const tabs = buildMailTabs({
			emailId: EMAIL_ID,
			active: "articles",
			counts: { articles: 0, excluded: 0 },
		});

		expect(tabs.map((tab) => tab.label)).toEqual([
			"View",
			"Extracted Articles (0)",
			"Skipped (0)",
		]);
	});

	it("caps a large count the same way the queue's tab does", () => {
		const tabs = buildMailTabs({
			emailId: EMAIL_ID,
			active: "articles",
			counts: { articles: 150, excluded: 1 },
		});

		expect(tabs[1].label).toBe("Extracted Articles (99+)");
		expect(tabs[2].label).toBe("Skipped (1)");
	});

	it("omits the count while extraction has not reported, so no tab claims a total yet", () => {
		const tabs = buildMailTabs({ emailId: EMAIL_ID, active: "articles", counts: NO_COUNTS });

		expect(tabs.map((tab) => tab.label)).toEqual(["View", "Extracted Articles", "Skipped"]);
	});
});
