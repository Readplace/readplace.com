import {
	MENU_ITEM_SAVE_ALL_TABS,
	MENU_ITEM_SAVE_LINK,
	MENU_ITEM_SAVE_PAGE,
	type ContextMenuItem,
	type ContextMenuItemId,
} from "browser-extension-core";

type ContextType = "page" | "link" | "browser_action" | "tab" | "tools_menu";

type MenusApi = {
	removeAll: () => Promise<void>;
	create: (properties: { id: string; title: string; contexts: ContextType[] }) => void;
};

const CONTEXTS_BY_MENU_ITEM: Record<ContextMenuItemId, ContextType[]> = {
	[MENU_ITEM_SAVE_PAGE]: ["page"],
	[MENU_ITEM_SAVE_LINK]: ["link"],
	[MENU_ITEM_SAVE_ALL_TABS]: ["page", "browser_action", "tab", "tools_menu"],
};

export function initCreateContextMenus(menus: MenusApi) {
	return async function createContextMenus(items: ContextMenuItem[]) {
		await menus.removeAll();
		for (const item of items) {
			menus.create({
				id: item.id,
				title: item.title,
				contexts: CONTEXTS_BY_MENU_ITEM[item.id],
			});
		}
	};
}
