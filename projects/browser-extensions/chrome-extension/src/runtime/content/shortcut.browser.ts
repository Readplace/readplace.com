/* c8 ignore start -- content script, runs in browser page context only */
import browser from "webextension-polyfill";
import { initAnnounceCaptureStarted, initCaptureHost, installShortcuts, isAppUrl, isHtmlDocument, matchesShortcut, navigationResponseStatus, resolveCanonicalUrlFromDocument, resolveContentShortcuts, ADVERTISED_CAPABILITIES_STORAGE_KEY, CAPTURE_STARTED_EVENT, COMMAND_BINDINGS_STORAGE_KEY, DEFAULT_SAVE_SHORTCUT, SAVE_ALL_SHORTCUT_MESSAGE_TYPE, type ContentShortcuts } from "browser-extension-core";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { isChromePdfViewerShell } from "./is-chrome-pdf-viewer-shell";

declare const __APP_DOMAINS__: string[];

const logger = HutchLogger.from(consoleLogger);

/** The listener is installed at document_start, before storage can answer, so
 * the matchers read this spec on every keystroke instead of being registered
 * from it. Save starts armed on the default so the shipped behaviour survives
 * the gap; save-all starts disarmed so a server without bulk save never has
 * its key swallowed. */
const armed: ContentShortcuts = {
	save: DEFAULT_SAVE_SHORTCUT,
	saveAll: null,
};

installShortcuts(document, [
	{
		matches: (event) => armed.save !== null && matchesShortcut(armed.save)(event),
		action: () => {
			browser.runtime.sendMessage({ type: "shortcut-pressed" });
		},
	},
	{
		matches: (event) => armed.saveAll !== null && matchesShortcut(armed.saveAll)(event),
		action: () => {
			browser.runtime.sendMessage({ type: SAVE_ALL_SHORTCUT_MESSAGE_TYPE });
		},
	},
]);

function loadStoredShortcuts(): void {
	browser.storage.local
		.get([COMMAND_BINDINGS_STORAGE_KEY, ADVERTISED_CAPABILITIES_STORAGE_KEY])
		.then((stored) => {
			const resolved = resolveContentShortcuts({
				storedBindings: stored[COMMAND_BINDINGS_STORAGE_KEY],
				storedCapabilities: stored[ADVERTISED_CAPABILITIES_STORAGE_KEY],
			});
			armed.save = resolved.save;
			armed.saveAll = resolved.saveAll;
		})
		.catch((err) => logger.error("Failed to read command shortcuts", err));
}

loadStoredShortcuts();

browser.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== "local") return;
	if (COMMAND_BINDINGS_STORAGE_KEY in changes || ADVERTISED_CAPABILITIES_STORAGE_KEY in changes) {
		loadStoredShortcuts();
	}
});

browser.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
	if ((raw as { type: string }).type === "capture-html") {
		sendResponse({
			rawHtml: isHtmlDocument(document) && !isChromePdfViewerShell(document) ? document.documentElement.outerHTML : "",
			title: document.title,
			canonicalUrl: resolveCanonicalUrlFromDocument({ document, requestedUrl: document.location.href }),
			responseStatus: navigationResponseStatus(performance),
		});
		return true;
	}
	return undefined;
});

if (isAppUrl({ tabUrl: location.href, appDomains: __APP_DOMAINS__ })) {
	const captureHost = initCaptureHost({
		document,
		requestRescue: (request) => browser.runtime.sendMessage(request),
		announceCaptureStarted: initAnnounceCaptureStarted({
			document,
			dispatch: () => document.dispatchEvent(new Event(CAPTURE_STARTED_EVENT)),
		}),
		logger,
	});
	new MutationObserver(() => {
		void captureHost.pageChanged();
	}).observe(document.documentElement, { childList: true, subtree: true });
	document.addEventListener("click", (event) => {
		if (event.target instanceof Element) void captureHost.tapped(event.target);
	});
}
/* c8 ignore stop */
