/* c8 ignore start -- content script, runs in browser page context only */
import { installShortcuts, isCmdD, isPdfViewerDocument } from "browser-extension-core";

installShortcuts(document, [
	{
		matches: isCmdD,
		action: () => {
			browser.runtime.sendMessage({ type: "shortcut-pressed" });
		},
	},
]);

browser.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
	if ((raw as { type: string }).type === "capture-html") {
		sendResponse({
			rawHtml: isPdfViewerDocument(document) ? "" : document.documentElement.outerHTML,
			title: document.title,
		});
		return true;
	}
	return undefined;
});
/* c8 ignore stop */
