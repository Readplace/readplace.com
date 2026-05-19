/* c8 ignore start -- content script, runs in browser page context only */
import browser from "webextension-polyfill";

// Chrome won't let extensions override Cmd+D via the commands API — it silently
// refuses to assign shortcuts that conflict with native browser shortcuts.
// action.openPopup() only works from specific user action contexts
// (commands.onCommand, action.onClicked), NOT from runtime.onMessage.
// So we intercept Cmd+D here at the DOM level to block the native bookmark dialog,
// then message the background which opens the popup in a window via windows.create().
document.addEventListener(
	"keydown",
	(event) => {
		if ((event.metaKey || event.ctrlKey) && event.key === "d") {
			event.preventDefault();
			event.stopPropagation();
			browser.runtime.sendMessage({ type: "shortcut-pressed" });
		}
	},
	true,
);

browser.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
	if ((raw as { type: string }).type === "capture-html") {
		sendResponse({
			rawHtml: document.documentElement.outerHTML,
			title: document.title,
		});
		return true;
	}
	return undefined;
});
/* c8 ignore stop */
