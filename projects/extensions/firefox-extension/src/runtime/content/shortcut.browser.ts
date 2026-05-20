/* c8 ignore start -- content script, runs in browser page context only */

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
