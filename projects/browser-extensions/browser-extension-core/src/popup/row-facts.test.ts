import { rowFacts } from "./row-facts";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

describe("rowFacts", () => {
	it("lists the site, then when it was saved", () => {
		const facts = rowFacts({
			url: "https://www.ideable.com/remote-culture",
			savedAt: new Date(Date.now() - TWO_HOURS_MS),
		});

		expect(facts).toEqual([
			{ kind: "site", text: "www.ideable.com", iconName: "globe" },
			{ kind: "saved", text: "2h ago", iconName: "clock" },
		]);
	});

	it("drops the site when the web address has no host", () => {
		const facts = rowFacts({ url: "", savedAt: new Date(Date.now() - TWO_HOURS_MS) });

		expect(facts).toEqual([{ kind: "saved", text: "2h ago", iconName: "clock" }]);
	});
});
