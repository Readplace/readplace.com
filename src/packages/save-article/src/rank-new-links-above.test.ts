import { rankNewLinksAbove } from "./rank-new-links-above";

const instantsFrom = (base: number, count: number): Date[] =>
	Array.from({ length: count }, (_, i) => new Date(base + i));

describe("rankNewLinksAbove", () => {
	it("hands the newest instants to links being created, keeping batch order inside each group", () => {
		const items = [
			{ url: "a", isNew: false },
			{ url: "b", isNew: true },
			{ url: "c", isNew: false },
			{ url: "d", isNew: true },
		];

		const ranked = rankNewLinksAbove({
			items,
			instants: instantsFrom(1000, 4),
			isNew: (item) => item.isNew,
		});

		expect(ranked.map((d) => d.getTime())).toEqual([1000, 1002, 1001, 1003]);
	});

	it("keeps a batch of only re-saved links in batch order", () => {
		const items = ["a", "b", "c"];

		const ranked = rankNewLinksAbove({
			items,
			instants: instantsFrom(1000, 3),
			isNew: () => false,
		});

		expect(ranked.map((d) => d.getTime())).toEqual([1000, 1001, 1002]);
	});

	it("keeps a batch of only new links in batch order", () => {
		const items = ["a", "b", "c"];

		const ranked = rankNewLinksAbove({
			items,
			instants: instantsFrom(1000, 3),
			isNew: () => true,
		});

		expect(ranked.map((d) => d.getTime())).toEqual([1000, 1001, 1002]);
	});

	it("refuses a span that does not cover every item", () => {
		expect(() =>
			rankNewLinksAbove({
				items: ["a", "b"],
				instants: instantsFrom(1000, 1),
				isNew: () => false,
			}),
		).toThrow("one allocated instant per item");
	});
});
