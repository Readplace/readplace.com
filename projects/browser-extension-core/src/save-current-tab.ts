import type { SaveUrl, SaveUrlResult } from "./reading-list/reading-list.types";

interface TabInfo {
	url: string;
	title: string;
	rawHtml?: string;
	pdfBytes?: ArrayBuffer;
}

export function initSaveCurrentTab(deps: {
	saveUrl: SaveUrl;
}): (tab: TabInfo) => Promise<SaveUrlResult> {
	return (tab) =>
		deps.saveUrl({
			url: tab.url,
			title: tab.title,
			rawHtml: tab.rawHtml,
			pdfBytes: tab.pdfBytes,
		});
}
