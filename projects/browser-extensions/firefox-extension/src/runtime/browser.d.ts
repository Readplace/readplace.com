declare namespace browser {
	namespace storage {
		interface StorageChange {
			oldValue?: unknown;
			newValue?: unknown;
		}

		namespace local {
			// biome-ignore lint/suspicious/noExplicitAny: browser API returns dynamic values
			function get(key: string | string[]): Promise<Record<string, any>>;
			function set(items: Record<string, unknown>): Promise<void>;
			function remove(key: string): Promise<void>;
		}
		namespace session {
			// biome-ignore lint/suspicious/noExplicitAny: browser API returns dynamic values
			function get(key: string | string[]): Promise<Record<string, any>>;
			function set(items: Record<string, unknown>): Promise<void>;
			function remove(key: string): Promise<void>;
		}

		const onChanged: {
			addListener(
				callback: (
					changes: Record<string, StorageChange>,
					areaName: string,
				) => void,
			): void;
		};
	}

	namespace commands {
		interface Command {
			name?: string;
			description?: string;
			shortcut?: string;
		}

		function getAll(): Promise<Command[]>;

		const onCommand: {
			addListener(callback: (command: string) => void): void;
		};

		interface CommandsChanged {
			addListener(callback: () => void): void;
		}

		/** Firefox grew this in 115, and the manifest still supports 109 — the
		 * optional type is what forces the caller to feature-detect. */
		const onChanged: CommandsChanged | undefined;
	}

	namespace runtime {
		interface MessageSender {
			tab?: tabs.Tab;
		}

		function sendMessage(message: unknown): Promise<unknown>;
		function getURL(path: string): string;
		function getManifest(): { version: string };

		const onMessage: {
			addListener(
				callback: (
					message: unknown,
					sender: MessageSender,
					sendResponse: (response: unknown) => void,
				) => true | undefined,
			): void;
		};
	}

	namespace tabs {
		interface Tab {
			id?: number;
			url?: string;
			title?: string;
			windowId: number;
		}

		function query(queryInfo: {
			active?: boolean;
			currentWindow?: boolean;
		}): Promise<Tab[]>;

		function get(tabId: number): Promise<Tab>;

		function create(createProperties: {
			url?: string;
			active?: boolean;
			openerTabId?: number;
		}): Promise<Tab>;

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

		const onRemoved: {
			addListener(
				callback: (
					tabId: number,
					removeInfo: { windowId: number; isWindowClosing: boolean },
				) => void,
			): void;
			removeListener(
				callback: (
					tabId: number,
					removeInfo: { windowId: number; isWindowClosing: boolean },
				) => void,
			): void;
		};
	}

	namespace browserAction {
		function setIcon(details: {
			tabId?: number;
			path?: Record<number, string>;
			imageData?: Record<number, ImageData>;
		}): Promise<void>;
		function openPopup(): Promise<void>;
	}

	namespace notifications {
		interface CreateNotificationOptions {
			type: "basic";
			iconUrl: string;
			title: string;
			message: string;
		}

		function create(options: CreateNotificationOptions): Promise<string>;
	}

	namespace menus {
		type ContextType =
			| "page"
			| "link"
			| "browser_action"
			| "tab"
			| "tools_menu";

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
				callback: (info: OnClickData, tab?: tabs.Tab) => void,
			): void;
		};
	}
}
