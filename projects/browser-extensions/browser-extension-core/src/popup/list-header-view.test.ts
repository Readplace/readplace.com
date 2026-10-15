import type { SortDescriptor } from "../reading-list/reading-list.types";
import { buildListHeaderView } from "./list-header-view";

const newestFirst: SortDescriptor = { label: "Newest first", rel: "current", order: "desc" };
const oldestFirst: SortDescriptor = { label: "Oldest first", rel: "sort", order: "asc" };

describe("buildListHeaderView", () => {
	it("passes the server's count label through verbatim", () => {
		const view = buildListHeaderView({ total: { label: "86 Saved Articles" }, sort: [] });

		expect(view.countLabel).toBe("86 Saved Articles");
	});

	it("leaves the count out when the server sent no total", () => {
		const view = buildListHeaderView({ total: undefined, sort: [newestFirst, oldestFirst] });

		expect(view.countLabel).toBeNull();
	});

	it("names the current order with a down arrow and toggles to the other", () => {
		const view = buildListHeaderView({ total: undefined, sort: [newestFirst, oldestFirst] });

		expect(view.sort).toEqual({ label: "Newest first", iconName: "arrow-down", toggleIndex: 1 });
	});

	it("names an ascending current order with an up arrow", () => {
		const view = buildListHeaderView({
			total: undefined,
			sort: [
				{ label: "Newest first", rel: "sort", order: "desc" },
				{ label: "Oldest first", rel: "current", order: "asc" },
			],
		});

		expect(view.sort).toEqual({ label: "Oldest first", iconName: "arrow-up", toggleIndex: 0 });
	});

	it("offers no sort when the server lists no other order", () => {
		const view = buildListHeaderView({ total: undefined, sort: [newestFirst] });

		expect(view.sort).toBeNull();
	});

	it("offers no sort when no order is current", () => {
		const view = buildListHeaderView({
			total: undefined,
			sort: [oldestFirst, { label: "Newest first", rel: "sort", order: "desc" }],
		});

		expect(view.sort).toBeNull();
	});

	it("offers no sort when the server sent none", () => {
		const view = buildListHeaderView({ total: undefined, sort: [] });

		expect(view.sort).toBeNull();
	});
});
