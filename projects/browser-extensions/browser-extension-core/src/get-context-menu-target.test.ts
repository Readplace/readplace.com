import {
	MENU_ITEM_SAVE_LINK,
	MENU_ITEM_SAVE_PAGE,
	initGetContextMenuTarget,
} from "./get-context-menu-target";

describe("initGetContextMenuTarget", () => {
	describe("save page", () => {
		it("should return the page URL and title from the tab", () => {
			const getTarget = initGetContextMenuTarget();

			const result = getTarget(
				{ menuItemId: MENU_ITEM_SAVE_PAGE, pageUrl: "https://example.com/article" },
				{ url: "https://example.com/article", title: "Example Article" },
			);

			expect(result).toEqual({
				url: "https://example.com/article",
				title: "Example Article",
			});
		});

		it("should fall back to pageUrl when tab has no URL", () => {
			const getTarget = initGetContextMenuTarget();

			const result = getTarget(
				{ menuItemId: MENU_ITEM_SAVE_PAGE, pageUrl: "https://example.com/page" },
				{ title: "Some Title" },
			);

			expect(result).toEqual({
				url: "https://example.com/page",
				title: "Some Title",
			});
		});

		it("should use URL as title when tab has no title", () => {
			const getTarget = initGetContextMenuTarget();

			const result = getTarget(
				{ menuItemId: MENU_ITEM_SAVE_PAGE, pageUrl: "https://example.com/no-title" },
			);

			expect(result).toEqual({
				url: "https://example.com/no-title",
				title: "https://example.com/no-title",
			});
		});

		it("should return null when page has no URL", () => {
			const getTarget = initGetContextMenuTarget();

			const result = getTarget(
				{ menuItemId: MENU_ITEM_SAVE_PAGE },
				{ title: "No URL Page" },
			);

			expect(result).toBeNull();
		});
	});

	describe("save link", () => {
		it("should return the link URL using linkUrl as both url and title", () => {
			const getTarget = initGetContextMenuTarget();

			const result = getTarget(
				{ menuItemId: MENU_ITEM_SAVE_LINK, linkUrl: "https://example.com/linked" },
				{ url: "https://example.com/page", title: "Page Title" },
			);

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

			const result = getTarget(
				{ menuItemId: "unknown-item", pageUrl: "https://example.com" },
				{ url: "https://example.com", title: "Example" },
			);

			expect(result).toBeNull();
		});
	});
});
