export const MENU_ITEM_SAVE_PAGE = "save-page-to-hutch";
export const MENU_ITEM_SAVE_LINK = "save-link-to-hutch";

interface ClickInfo {
	menuItemId: string;
	linkUrl?: string;
	pageUrl?: string;
}

interface TabInfo {
	url?: string;
	title?: string;
}

type ContextMenuTarget = { url: string; title: string };

export function initGetContextMenuTarget(): (info: ClickInfo, tab?: TabInfo) => ContextMenuTarget | null {
	return (info, tab) => {
		if (info.menuItemId === MENU_ITEM_SAVE_LINK && info.linkUrl) {
			return { url: info.linkUrl, title: info.linkUrl };
		}

		if (info.menuItemId === MENU_ITEM_SAVE_PAGE) {
			const url = info.pageUrl ?? tab?.url;
			if (!url) return null;
			return { url, title: tab?.title ?? url };
		}

		return null;
	};
}
