import { buildMailTabs } from "./mail-tabs";

describe("buildMailTabs", () => {
	it("marks the active tab with aria-current and leaves the others unset", () => {
		const tabs = buildMailTabs("view");

		expect(tabs.map((tab) => tab.key)).toEqual(["view", "articles"]);
		expect(tabs.map((tab) => tab.label)).toEqual(["View", "Articles"]);
		expect(tabs[0].ariaCurrent).toBe("page");
		expect(tabs[1].ariaCurrent).toBeUndefined();
	});
});
