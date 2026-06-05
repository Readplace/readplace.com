import { initCreateContextMenus } from "./create-context-menus";

// Safari runs the extension's background as a non-persistent page
// ("persistent": false), so the system can unload it and re-run the top-level
// script at any time. Each restart calls createContextMenus again, and
// contextMenus.create throws "duplicate id" if an item with the same id already
// exists. This test verifies the implementation clears existing menus before
// creating new ones, so background restarts don't produce errors.

function createFakeContextMenus() {
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
	it("should not throw when called twice, because Safari's non-persistent background restarts and re-runs the script", async () => {
		const contextMenus = createFakeContextMenus();
		const createContextMenus = initCreateContextMenus(contextMenus);

		await createContextMenus();
		await createContextMenus();

		expect(contextMenus.registeredIds).toEqual(
			expect.arrayContaining(["save-page-to-hutch", "save-link-to-hutch"]),
		);
	});
});
