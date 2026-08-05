import {
	MENU_ITEM_SAVE_LINK,
	initGetContextMenuTarget,
} from "./get-context-menu-target";

describe("initGetContextMenuTarget", () => {
	describe("save link", () => {
		it("should return the link URL using linkUrl as both url and title", () => {
			const getTarget = initGetContextMenuTarget();

			const result = getTarget({
				menuItemId: MENU_ITEM_SAVE_LINK,
				linkUrl: "https://example.com/linked",
			});

			expect(result).toEqual({
				url: "https://example.com/linked",
				title: "https://example.com/linked",
			});
		});

		it("should return null when link menu clicked without linkUrl", () => {
			const getTarget = initGetContextMenuTarget();

			const result = getTarget({ menuItemId: MENU_ITEM_SAVE_LINK });

			expect(result).toBeNull();
		});
	});

	describe("unknown menu item", () => {
		it("should return null for an unrecognized menu item ID", () => {
			const getTarget = initGetContextMenuTarget();

			const result = getTarget({ menuItemId: "unknown-item" });

			expect(result).toBeNull();
		});
	});
});
