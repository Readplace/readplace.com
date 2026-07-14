import { buildMailTabs } from "./mail-tabs";

const EMAIL_ID = "2026-06-24T09:00:00.000Z#<m@x>";
const ENCODED_EMAIL_ID = "2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E";

describe("buildMailTabs", () => {
	it("marks the active tab with aria-current and leaves the others unset", () => {
		const tabs = buildMailTabs({ emailId: EMAIL_ID, active: "view" });

		expect(tabs.map((tab) => tab.key)).toEqual(["view", "articles"]);
		expect(tabs.map((tab) => tab.label)).toEqual(["View", "Articles"]);
		expect(tabs[0].ariaCurrent).toBe("page");
		expect(tabs[1].ariaCurrent).toBeUndefined();
	});

	it("moves aria-current to the Articles tab when it is the active one", () => {
		const tabs = buildMailTabs({ emailId: EMAIL_ID, active: "articles" });

		expect(tabs[0].ariaCurrent).toBeUndefined();
		expect(tabs[1].ariaCurrent).toBe("page");
	});

	it("links every tab to its own URL, carrying the feature flag the surface needs", () => {
		const tabs = buildMailTabs({ emailId: EMAIL_ID, active: "view" });

		expect(tabs.map((tab) => tab.href)).toEqual([
			`/inbox/${ENCODED_EMAIL_ID}?feature=email`,
			`/inbox/${ENCODED_EMAIL_ID}?feature=email&tab=articles`,
		]);
	});
});
