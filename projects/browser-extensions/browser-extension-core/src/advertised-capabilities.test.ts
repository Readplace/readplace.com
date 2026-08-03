import {
	advertisesBulkSave,
	contextMenuItemsFor,
} from "./advertised-capabilities";
import {
	MENU_ITEM_SAVE_ALL_TABS,
	MENU_ITEM_SAVE_LINK,
	MENU_ITEM_SAVE_PAGE,
} from "./get-context-menu-target";

describe("contextMenuItemsFor", () => {
	it("offers every save entry point before the first walk, so a logged-out reader can still start one", () => {
		expect(contextMenuItemsFor(null).map((item) => item.id)).toEqual([
			MENU_ITEM_SAVE_PAGE,
			MENU_ITEM_SAVE_LINK,
			MENU_ITEM_SAVE_ALL_TABS,
		]);
	});

	it("derives the page and link entries from the single-save capability", () => {
		expect(contextMenuItemsFor(["save-article"])).toEqual([
			{ id: MENU_ITEM_SAVE_PAGE, title: "Save Page to Readplace" },
			{ id: MENU_ITEM_SAVE_LINK, title: "Save Link to Readplace" },
		]);
	});

	it("derives the save-all entry from the bulk-save capability", () => {
		expect(contextMenuItemsFor(["save-articles"])).toEqual([
			{ id: MENU_ITEM_SAVE_ALL_TABS, title: "Save All Tabs to Readplace" },
		]);
	});

	it("drops a capability it has no entry point for, so a new server action adds no mystery menu", () => {
		expect(contextMenuItemsFor(["search", "create-session"])).toEqual([]);
	});

	it("offers nothing once the server advertises no save capability at all", () => {
		expect(contextMenuItemsFor([])).toEqual([]);
	});
});

describe("advertisesBulkSave", () => {
	it("assumes bulk save is available before the first walk", () => {
		expect(advertisesBulkSave(null)).toBe(true);
	});

	it("reports bulk save available when the server advertises it", () => {
		expect(advertisesBulkSave(["save-article", "save-articles"])).toBe(true);
	});

	it("reports bulk save unavailable when the server advertises only single saves", () => {
		expect(advertisesBulkSave(["save-article"])).toBe(false);
	});
});
