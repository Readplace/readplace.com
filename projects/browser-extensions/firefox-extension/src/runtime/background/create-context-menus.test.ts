import {
	MENU_ITEM_SAVE_ALL_TABS,
	MENU_ITEM_SAVE_LINK,
	MENU_ITEM_SAVE_PAGE,
	type ContextMenuItem,
} from "browser-extension-core";
import { initCreateContextMenus } from "./create-context-menus";

function createFakeFirefoxMenus() {
	const created = new Map<string, string[]>();
	return {
		removeAll: async () => {
			created.clear();
		},
		create: (properties: { id: string; title: string; contexts: string[] }) => {
			if (created.has(properties.id)) {
				throw new Error(`Cannot create item with duplicate id ${properties.id}`);
			}
			created.set(properties.id, properties.contexts);
		},
		get registeredIds() {
			return [...created.keys()];
		},
		contextsOf: (id: string) => created.get(id),
	};
}

const EVERY_ITEM: ContextMenuItem[] = [
	{ id: MENU_ITEM_SAVE_PAGE, title: "Save Page to Readplace" },
	{ id: MENU_ITEM_SAVE_LINK, title: "Save Link to Readplace" },
	{ id: MENU_ITEM_SAVE_ALL_TABS, title: "Save All Tabs to Readplace" },
];

describe("createContextMenus", () => {
	it("names the tab strip and the Tools menu outright, because Firefox's all context leaves both out", async () => {
		const menus = createFakeFirefoxMenus();

		await initCreateContextMenus(menus)(EVERY_ITEM);

		expect(menus.contextsOf(MENU_ITEM_SAVE_ALL_TABS)).toEqual([
			"page",
			"browser_action",
			"tab",
			"tools_menu",
		]);
	});

	it("keeps the single-save entries on the surface each one targets", async () => {
		const menus = createFakeFirefoxMenus();

		await initCreateContextMenus(menus)(EVERY_ITEM);

		expect(menus.contextsOf(MENU_ITEM_SAVE_PAGE)).toEqual(["page"]);
		expect(menus.contextsOf(MENU_ITEM_SAVE_LINK)).toEqual(["link"]);
	});

	it("registers only the items it is given, so a capability the server dropped leaves no menu behind", async () => {
		const menus = createFakeFirefoxMenus();
		const createContextMenus = initCreateContextMenus(menus);

		await createContextMenus(EVERY_ITEM);
		await createContextMenus([
			{ id: MENU_ITEM_SAVE_PAGE, title: "Save Page to Readplace" },
		]);

		expect(menus.registeredIds).toEqual([MENU_ITEM_SAVE_PAGE]);
	});
});
