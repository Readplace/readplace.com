import type { SetIcon } from "./icon-status";

export interface BrowserShell {
	onShortcutPressed: (handler: () => void) => void;
	/** `tabId` is the tab whose own page is being saved, and is absent whenever
	 * the target is not that page (a saved link, or a target that arrived without
	 * a tab). It travels with the target so the save can set that tab's icon from
	 * its own outcome instead of asking the server which tab is showing what. */
	openPopup: (params: { url: string; title: string; tabId?: number }) => void;
	openSaveAllTabsPopup: () => void;
	getActiveTab: () => Promise<{ id?: number; url: string; title: string } | null>;
	queryActiveTabs: () => Promise<Array<{ id?: number; url?: string; title?: string }>>;
	setIcon: SetIcon;
	createContextMenus: () => void;
	onContextMenuClicked: (handler: (info: {
		menuItemId: string;
		linkUrl?: string;
		pageUrl?: string;
	}, tab?: { id?: number; url?: string; title?: string }) => void) => void;
	onTabActivated: (handler: (tabId: number, url: string) => void) => void;
	onTabUpdated: (handler: (tabId: number, url: string) => void) => void;
}
