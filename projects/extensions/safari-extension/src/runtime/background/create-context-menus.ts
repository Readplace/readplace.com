import {
	MENU_ITEM_SAVE_PAGE,
	MENU_ITEM_SAVE_LINK,
} from "browser-extension-core";

type ContextMenusApi = {
	removeAll: () => Promise<void>;
	create: (properties: { id: string; title: string; contexts: ("page" | "link")[] }) => void;
};

export function initCreateContextMenus(contextMenus: ContextMenusApi) {
	return async function createContextMenus() {
		await contextMenus.removeAll();
		contextMenus.create({
			id: MENU_ITEM_SAVE_PAGE,
			title: "Save Page to Readplace",
			contexts: ["page"],
		});
		contextMenus.create({
			id: MENU_ITEM_SAVE_LINK,
			title: "Save Link to Readplace",
			contexts: ["link"],
		});
	};
}
