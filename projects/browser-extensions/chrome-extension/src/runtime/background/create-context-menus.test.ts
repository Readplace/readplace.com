import {
	MENU_ITEM_SAVE_ALL_TABS,
	MENU_ITEM_SAVE_LINK,
	type ContextMenuItem,
} from "browser-extension-core";
import { initCreateContextMenus } from "./create-context-menus";

// Chrome's Manifest V3 uses a service worker that can be stopped and
// restarted at any time. Each restart re-executes the top-level script,
// which calls createContextMenus again. Chrome's contextMenus.create
// throws "Cannot create item with duplicate id" if an item with the
// same id already exists. This test verifies that the implementation
// clears existing menus before creating new ones, so service worker
// restarts don't produce errors.

function createFakeChromeContextMenus() {
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
	{ id: MENU_ITEM_SAVE_LINK, title: "Save Link to Readplace" },
	{ id: MENU_ITEM_SAVE_ALL_TABS, title: "Save All Tabs to Readplace" },
];

describe("createContextMenus", () => {
	it("should not throw when called twice, because Chrome MV3 service workers restart and re-run the script", async () => {
		const contextMenus = createFakeChromeContextMenus();
		const createContextMenus = initCreateContextMenus(contextMenus);

		await createContextMenus(EVERY_ITEM);
		await createContextMenus(EVERY_ITEM);

		expect(contextMenus.registeredIds).toEqual([
			MENU_ITEM_SAVE_LINK,
			MENU_ITEM_SAVE_ALL_TABS,
		]);
	});

	it("offers save-all-tabs on the page and on the toolbar icon, the two surfaces Chrome supports for it", async () => {
		const contextMenus = createFakeChromeContextMenus();

		await initCreateContextMenus(contextMenus)(EVERY_ITEM);

		expect(contextMenus.contextsOf(MENU_ITEM_SAVE_ALL_TABS)).toEqual([
			"page",
			"action",
		]);
	});

	it("keeps the save-link entry on the link surface, the only place a link is right-clicked", async () => {
		const contextMenus = createFakeChromeContextMenus();

		await initCreateContextMenus(contextMenus)(EVERY_ITEM);

		expect(contextMenus.contextsOf(MENU_ITEM_SAVE_LINK)).toEqual(["link"]);
	});

	it("registers only the items it is given, so a capability the server dropped leaves no menu behind", async () => {
		const contextMenus = createFakeChromeContextMenus();
		const createContextMenus = initCreateContextMenus(contextMenus);

		await createContextMenus(EVERY_ITEM);
		await createContextMenus([
			{ id: MENU_ITEM_SAVE_LINK, title: "Save Link to Readplace" },
		]);

		expect(contextMenus.registeredIds).toEqual([MENU_ITEM_SAVE_LINK]);
	});
});
