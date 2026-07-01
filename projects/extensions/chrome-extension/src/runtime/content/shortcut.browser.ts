/* c8 ignore start -- content script, runs in browser page context only */
import browser from "webextension-polyfill";
import { installShortcuts, isCmdD, isPdfViewerDocument, resolveCanonicalUrlFromDocument } from "browser-extension-core";
import { isChromePdfViewerShell } from "./is-chrome-pdf-viewer-shell";

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
			rawHtml: isPdfViewerDocument(document) || isChromePdfViewerShell(document) ? "" : document.documentElement.outerHTML,
			title: document.title,
			canonicalUrl: resolveCanonicalUrlFromDocument({ document, requestedUrl: document.location.href }),
		});
		return true;
	}
	return undefined;
});
/* c8 ignore stop */
