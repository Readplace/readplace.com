import {
	MENU_ITEM_SAVE_ALL_TABS,
	MENU_ITEM_SAVE_LINK,
	MENU_ITEM_SAVE_PAGE,
} from "./get-context-menu-target";

export type ContextMenuItemId =
	| typeof MENU_ITEM_SAVE_PAGE
	| typeof MENU_ITEM_SAVE_LINK
	| typeof MENU_ITEM_SAVE_ALL_TABS;

export type ContextMenuItem = { id: ContextMenuItemId; title: string };

const BULK_SAVE_CAPABILITY = "save-articles";

const MENU_ITEMS_BY_CAPABILITY: Record<string, ContextMenuItem[]> = {
	"save-article": [
		{ id: MENU_ITEM_SAVE_PAGE, title: "Save Page to Readplace" },
		{ id: MENU_ITEM_SAVE_LINK, title: "Save Link to Readplace" },
	],
	[BULK_SAVE_CAPABILITY]: [
		{ id: MENU_ITEM_SAVE_ALL_TABS, title: "Save All Tabs to Readplace" },
	],
};

const EVERY_MENU_ITEM: ContextMenuItem[] = Object.values(
	MENU_ITEMS_BY_CAPABILITY,
).flat();

export function contextMenuItemsFor(
	capabilities: readonly string[] | null,
): ContextMenuItem[] {
	if (capabilities === null) return EVERY_MENU_ITEM;
	return capabilities.flatMap((name) => MENU_ITEMS_BY_CAPABILITY[name] ?? []);
}

export function advertisesBulkSave(
	capabilities: readonly string[] | null,
): boolean {
	return capabilities === null || capabilities.includes(BULK_SAVE_CAPABILITY);
}
