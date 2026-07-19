import browser from "webextension-polyfill";
import type { SetIcon } from "browser-extension-core";
import { getSavedIconData } from "./saved-icon.browser";

// One variant ships for every toolbar: Chromium exposes no API for the toolbar
// colour, and `prefers-color-scheme` answers for the OS, which a custom or
// auto-generated browser theme overrides. The halo disappears into a light
// toolbar and carries the shape against a dark one. It does thin out against
// mid-greys (~#666–#8A) — a custom theme landing there wants new art, not
// another attempt at detection.
const ICON_PATHS: Record<number, string> = {
	16: browser.runtime.getURL("icons/light/icon-16.png"),
	32: browser.runtime.getURL("icons/light/icon-32.png"),
	48: browser.runtime.getURL("icons/light/icon-48.png"),
	64: browser.runtime.getURL("icons/light/icon-64.png"),
};

export function createBrowserSetIcon(): SetIcon {
	return {
		showSaved: async (tabId) => {
			const imageData = await getSavedIconData();
			await browser.action.setIcon({ tabId, imageData });
		},
		showDefault: async (tabId) => {
			await browser.action.setIcon({ tabId, path: ICON_PATHS });
		},
	};
}
