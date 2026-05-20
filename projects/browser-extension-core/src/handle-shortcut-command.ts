type ShortcutTarget = { url: string; title: string };

export function initGetShortcutTarget(deps: {
	queryActiveTabs: () => Promise<Array<{ id?: number; url?: string; title?: string }>>;
}): () => Promise<ShortcutTarget | null> {
	return async () => {
		const tabs = await deps.queryActiveTabs();
		const tab = tabs[0];
		if (!tab?.url) return null;
		return { url: tab.url, title: tab.title ?? tab.url };
	};
}
