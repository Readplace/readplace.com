import type { ContextMenuItem } from "./advertised-capabilities";
import {
	MENU_ITEM_SAVE_ALL_TABS,
	MENU_ITEM_SAVE_LINK,
} from "./get-context-menu-target";
import {
	type AdvertisedCapabilityStore,
	initSyncContextMenus,
	parseStoredCapabilities,
} from "./sync-context-menus";

function createRecordingMenus() {
	const registrations: ContextMenuItem[][] = [];
	return {
		registrations,
		registerMenus: async (items: ContextMenuItem[]) => {
			registrations.push(items);
		},
		registeredIds: () => registrations.map((items) => items.map((item) => item.id)),
	};
}

function createInMemoryStore(initial: unknown): AdvertisedCapabilityStore & {
	written: string[][];
} {
	let held = initial;
	const written: string[][] = [];
	return {
		written,
		read: async () => held,
		write: async (capabilities) => {
			written.push(capabilities);
			held = capabilities;
		},
	};
}

describe("parseStoredCapabilities", () => {
	it("reads back the capability names it was given", () => {
		expect(parseStoredCapabilities(["save-article", "save-articles"])).toEqual([
			"save-article",
			"save-articles",
		]);
	});

	it("reports nothing known for a value no walk has written yet", () => {
		expect(parseStoredCapabilities(undefined)).toBeNull();
	});

	it("reports nothing known for a stored shape it cannot read", () => {
		expect(parseStoredCapabilities({ names: ["save-article"] })).toBeNull();
	});
});

describe("initSyncContextMenus", () => {
	it("registers every entry point at startup when no walk has reported capabilities yet", async () => {
		const menus = createRecordingMenus();
		const sync = initSyncContextMenus({
			store: createInMemoryStore(undefined),
			registerMenus: menus.registerMenus,
		});

		await sync.applyCached();

		expect(menus.registeredIds()).toEqual([
			[MENU_ITEM_SAVE_LINK, MENU_ITEM_SAVE_ALL_TABS],
		]);
	});

	it("registers the cached capabilities at startup, before any walk has run", async () => {
		const menus = createRecordingMenus();
		const sync = initSyncContextMenus({
			store: createInMemoryStore(["save-articles"]),
			registerMenus: menus.registerMenus,
		});

		await sync.applyCached();

		expect(menus.registeredIds()).toEqual([[MENU_ITEM_SAVE_ALL_TABS]]);
	});

	it("persists and registers the capabilities a walk discovered", async () => {
		const menus = createRecordingMenus();
		const store = createInMemoryStore(undefined);
		const sync = initSyncContextMenus({ store, registerMenus: menus.registerMenus });

		await sync.applyCached();
		await sync.capabilitiesDiscovered(["save-article"]);

		expect(store.written).toEqual([["save-article"]]);
		expect(menus.registeredIds()).toEqual([
			[MENU_ITEM_SAVE_LINK, MENU_ITEM_SAVE_ALL_TABS],
			[MENU_ITEM_SAVE_LINK],
		]);
	});

	it("leaves the menus alone when a walk reports what is already registered", async () => {
		const menus = createRecordingMenus();
		const store = createInMemoryStore(["save-article", "save-articles"]);
		const sync = initSyncContextMenus({ store, registerMenus: menus.registerMenus });

		await sync.applyCached();
		await sync.capabilitiesDiscovered(["save-article", "save-articles"]);

		expect(store.written).toEqual([]);
		expect(menus.registeredIds()).toEqual([
			[MENU_ITEM_SAVE_LINK, MENU_ITEM_SAVE_ALL_TABS],
		]);
	});

	it("re-registers when a later walk reports the server dropped a capability", async () => {
		const menus = createRecordingMenus();
		const store = createInMemoryStore(["save-article", "save-articles"]);
		const sync = initSyncContextMenus({ store, registerMenus: menus.registerMenus });

		await sync.applyCached();
		await sync.capabilitiesDiscovered(["save-article"]);

		expect(store.written).toEqual([["save-article"]]);
		expect(menus.registeredIds()).toEqual([
			[MENU_ITEM_SAVE_LINK, MENU_ITEM_SAVE_ALL_TABS],
			[MENU_ITEM_SAVE_LINK],
		]);
	});
});
