import {
	MENU_ITEM_SAVE_ALL_TABS,
	MENU_ITEM_SAVE_LINK,
	type ContextMenuItem,
	type ContextMenuItemId,
} from "browser-extension-core";

type ContextType = "page" | "link" | "action";

type ContextMenusApi = {
	removeAll: () => Promise<void>;
	create: (properties: { id: string; title: string; contexts: ContextType[] }) => void;
};

const CONTEXTS_BY_MENU_ITEM: Record<ContextMenuItemId, ContextType[]> = {
	[MENU_ITEM_SAVE_LINK]: ["link"],
	[MENU_ITEM_SAVE_ALL_TABS]: ["page", "action"],
};

export function initCreateContextMenus(contextMenus: ContextMenusApi) {
	return async function createContextMenus(items: ContextMenuItem[]) {
		await contextMenus.removeAll();
		for (const item of items) {
			contextMenus.create({
				id: item.id,
				title: item.title,
				contexts: CONTEXTS_BY_MENU_ITEM[item.id],
			});
		}
	};
}
