/** The shortcut always targets the active tab's own page, so its id travels with
 * the target and a save can mark that tab from its own outcome. */
type ShortcutTarget = { url: string; title: string; tabId?: number };

export function initGetShortcutTarget(deps: {
	queryActiveTabs: () => Promise<Array<{ id?: number; url?: string; title?: string }>>;
}): () => Promise<ShortcutTarget | null> {
	return async () => {
		const tabs = await deps.queryActiveTabs();
		const tab = tabs[0];
		if (!tab?.url) return null;
		return { url: tab.url, title: tab.title ?? tab.url, tabId: tab.id };
	};
}
