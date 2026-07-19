import type { SaveUrl, SaveUrlResult, TabContent } from "./reading-list/reading-list.types";

interface TabInfo {
	url: string;
	title: string;
	content?: TabContent;
}

export function initSaveCurrentTab(deps: {
	saveUrl: SaveUrl;
}): (tab: TabInfo) => Promise<SaveUrlResult> {
	return (tab) =>
		deps.saveUrl({
			url: tab.url,
			title: tab.title,
			content: tab.content,
		});
}
