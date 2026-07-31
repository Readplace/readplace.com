export const MENU_ITEM_SAVE_PAGE = "save-page-to-hutch";
export const MENU_ITEM_SAVE_LINK = "save-link-to-hutch";
export const MENU_ITEM_SAVE_ALL_TABS = "save-all-tabs-to-hutch";

interface ClickInfo {
	menuItemId: string;
	linkUrl?: string;
	pageUrl?: string;
}

interface TabInfo {
	id?: number;
	url?: string;
	title?: string;
}

/** `tabId` is carried only when the target IS the tab's own page, so a save can
 * mark that tab without asking the server what it is showing. A saved link is a
 * different article than the page the tab is on, so it carries none — marking
 * the tab there would claim the page itself was saved. */
type ContextMenuTarget = { url: string; title: string; tabId?: number };

export function initGetContextMenuTarget(): (info: ClickInfo, tab?: TabInfo) => ContextMenuTarget | null {
	return (info, tab) => {
		if (info.menuItemId === MENU_ITEM_SAVE_LINK && info.linkUrl) {
			return { url: info.linkUrl, title: info.linkUrl };
		}

		if (info.menuItemId === MENU_ITEM_SAVE_PAGE) {
			const url = info.pageUrl ?? tab?.url;
			if (!url) return null;
			return { url, title: tab?.title ?? url, tabId: tab?.id };
		}

		return null;
	};
}
