declare module "webextension-polyfill" {
	namespace Storage {
		interface StorageChange {
			oldValue?: unknown;
			newValue?: unknown;
		}

		namespace Local {
			// biome-ignore lint/suspicious/noExplicitAny: browser API returns dynamic values
			function get(key: string | string[]): Promise<Record<string, any>>;
			function set(items: Record<string, unknown>): Promise<void>;
			function remove(key: string): Promise<void>;
		}
		namespace Session {
			// biome-ignore lint/suspicious/noExplicitAny: browser API returns dynamic values
			function get(key: string): Promise<Record<string, any>>;
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

	namespace Commands {
		interface Command {
			name?: string;
			description?: string;
			shortcut?: string;
		}

		function getAll(): Promise<Command[]>;

		const onCommand: {
			addListener(callback: (command: string) => void): void;
		};
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

	namespace Alarms {
		interface Alarm {
			name: string;
		}

		/** `create` is absent from the polyfill's async-method metadata, so it is
		 * handed back as the underlying callback-style API and returns nothing;
		 * `clear` is wrapped and does return a promise. */
		function create(name: string, alarmInfo: { when: number }): void;
		function clear(name: string): Promise<boolean>;

		const onAlarm: {
			addListener(callback: (alarm: Alarm) => void): void;
		};
	}

	namespace Tabs {
		interface Tab {
			id?: number;
			url?: string;
			title?: string;
		}

		function query(queryInfo: {
			active?: boolean;
			currentWindow?: boolean;
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
		function openPopup(): Promise<void>;
	}

	namespace ContextMenus {
		type ContextType = "page" | "link" | "action";

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

	namespace Notifications {
		interface CreateNotificationOptions {
			type: "basic";
			iconUrl: string;
			title: string;
			message: string;
		}

		function create(options: CreateNotificationOptions): Promise<string>;
	}

	const storage: { local: typeof Storage.Local; session: typeof Storage.Session };
	const runtime: typeof Runtime;
	const tabs: typeof Tabs;
	const action: typeof Action;
	const contextMenus: typeof ContextMenus;

	const browser: {
		storage: {
			local: typeof Storage.Local;
			session: typeof Storage.Session;
			onChanged: typeof Storage.onChanged;
		};
		runtime: typeof Runtime;
		tabs: typeof Tabs;
		action: typeof Action;
		alarms: typeof Alarms;
		commands: typeof Commands;
		contextMenus: typeof ContextMenus;
		notifications: typeof Notifications;
	};

	export default browser;
}
