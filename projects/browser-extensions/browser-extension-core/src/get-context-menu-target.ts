export const MENU_ITEM_SAVE_LINK = "save-link-to-hutch";
export const MENU_ITEM_SAVE_ALL_TABS = "save-all-tabs-to-hutch";

interface ClickInfo {
	menuItemId: string;
	linkUrl?: string;
}

type ContextMenuTarget = { url: string; title: string };

export function initGetContextMenuTarget(): (info: ClickInfo) => ContextMenuTarget | null {
	return (info) => {
		if (info.menuItemId === MENU_ITEM_SAVE_LINK && info.linkUrl) {
			return { url: info.linkUrl, title: info.linkUrl };
		}

		return null;
	};
}
