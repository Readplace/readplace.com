declare module "webextension-polyfill" {
	namespace Storage {
		namespace Local {
			// biome-ignore lint/suspicious/noExplicitAny: browser API returns dynamic values
			function get(key: string): Promise<Record<string, any>>;
			function set(items: Record<string, unknown>): Promise<void>;
			function remove(key: string): Promise<void>;
		}
	}

	namespace Runtime {
		function sendMessage(message: unknown): Promise<unknown>;
		function getURL(path: string): string;

		const onMessage: {
			addListener(
				callback: (
					message: unknown,
					sender: unknown,
					sendResponse: (response: unknown) => void,
				) => true | undefined,
			): void;
		};
	}

	namespace Tabs {
		interface Tab {
			id?: number;
			url?: string;
			title?: string;
		}

		function query(queryInfo: {
			active: boolean;
			currentWindow: boolean;
		}): Promise<Tab[]>;

		function get(tabId: number): Promise<Tab>;

		function create(createProperties: { url?: string }): Promise<Tab>;

		function remove(tabId: number): Promise<void>;

		function sendMessage(tabId: number, message: unknown): Promise<unknown>;

		const onActivated: {
			addListener(
				callback: (activeInfo: { tabId: number }) => void,
			): void;
		};

		const onUpdated: {
			addListener(
				callback: (
					tabId: number,
					changeInfo: { url?: string; status?: string },
					tab: Tab,
				) => void,
			): void;
			removeListener(
				callback: (
					tabId: number,
					changeInfo: { url?: string; status?: string },
					tab: Tab,
				) => void,
			): void;
		};
	}

	namespace Action {
		function setIcon(details: {
			tabId?: number;
			path?: Record<number, string>;
			imageData?: Record<number, ImageData>;
		}): Promise<void>;
	}

	namespace ContextMenus {
		type ContextType = "page" | "link";

		interface CreateProperties {
			id: string;
			title: string;
			contexts: ContextType[];
		}

		interface OnClickData {
			menuItemId: string;
			linkUrl?: string;
			pageUrl?: string;
		}

		function create(createProperties: CreateProperties): void;
		function removeAll(): Promise<void>;

		const onClicked: {
			addListener(
				callback: (info: OnClickData, tab?: Tabs.Tab) => void,
			): void;
		};
	}

	namespace Windows {
		function create(createData: {
			url?: string;
			type?: "normal" | "popup" | "panel" | "detached_panel";
			width?: number;
			height?: number;
		}): Promise<{ id?: number }>;

		function update(
			windowId: number,
			updateInfo: { focused?: boolean },
		): Promise<{ id?: number }>;

		function remove(windowId: number): Promise<void>;

		const onRemoved: {
			addListener(callback: (windowId: number) => void): void;
		};
	}

	const storage: { local: typeof Storage.Local };
	const runtime: typeof Runtime;
	const tabs: typeof Tabs;
	const action: typeof Action;
	const contextMenus: typeof ContextMenus;
	const windows: typeof Windows;

	const browser: {
		storage: { local: typeof Storage.Local };
		runtime: typeof Runtime;
		tabs: typeof Tabs;
		action: typeof Action;
		contextMenus: typeof ContextMenus;
		windows: typeof Windows;
	};

	export default browser;
}
