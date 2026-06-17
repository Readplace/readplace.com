import { initCreateContextMenus } from "./create-context-menus";

// Chrome's Manifest V3 uses a service worker that can be stopped and
// restarted at any time. Each restart re-executes the top-level script,
// which calls createContextMenus again. Chrome's contextMenus.create
// throws "Cannot create item with duplicate id" if an item with the
// same id already exists. This test verifies that the implementation
// clears existing menus before creating new ones, so service worker
// restarts don't produce errors.

function createFakeChromeContextMenus() {
	const ids = new Set<string>();
	return {
		removeAll: async () => {
			ids.clear();
		},
		create: (properties: { id: string; title: string; contexts: ("page" | "link")[] }) => {
			if (ids.has(properties.id)) {
				throw new Error(`Cannot create item with duplicate id ${properties.id}`);
			}
			ids.add(properties.id);
		},
		get registeredIds() {
			return [...ids];
		},
	};
}

describe("createContextMenus", () => {
	it("should not throw when called twice, because Chrome MV3 service workers restart and re-run the script", async () => {
		const contextMenus = createFakeChromeContextMenus();
		const createContextMenus = initCreateContextMenus(contextMenus);

		await createContextMenus();
		await createContextMenus();

		expect(contextMenus.registeredIds).toEqual(
			expect.arrayContaining([
				"save-page-to-hutch",
				"save-link-to-hutch",
				"save-all-tabs-to-hutch",
			]),
		);
	});
});
