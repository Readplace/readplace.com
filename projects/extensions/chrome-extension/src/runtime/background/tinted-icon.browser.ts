import browser from "webextension-polyfill";
import type { SetIcon } from "browser-extension-core";

interface SerializedImageData {
	width: number;
	height: number;
	data: number[];
}

type Theme = "dark" | "light";

// Dark variant = navy "&" + amber dot, no halo. Used on light browser themes.
// Light variant = same shapes wrapped in a white halo. Used on dark browser themes.
const VARIANT_PATHS: Record<Theme, Record<number, string>> = {
	dark: {
		16: browser.runtime.getURL("icons/dark/icon-16.png"),
		32: browser.runtime.getURL("icons/dark/icon-32.png"),
		48: browser.runtime.getURL("icons/dark/icon-48.png"),
		64: browser.runtime.getURL("icons/dark/icon-64.png"),
	},
	light: {
		16: browser.runtime.getURL("icons/light/icon-16.png"),
		32: browser.runtime.getURL("icons/light/icon-32.png"),
		48: browser.runtime.getURL("icons/light/icon-48.png"),
		64: browser.runtime.getURL("icons/light/icon-64.png"),
	},
};

let offscreenCreated = false;

async function ensureOffscreen(): Promise<void> {
	if (offscreenCreated) return;
	const hasDoc = await chrome.offscreen.hasDocument();
	if (hasDoc) {
		offscreenCreated = true;
		return;
	}
	await chrome.offscreen.createDocument({
		url: "offscreen/offscreen.html",
		reasons: ["CANVAS"],
		justification: "Tinting extension icons for saved state",
	});
	offscreenCreated = true;
}

let savedIconCache: Record<number, ImageData> | null = null;

async function getSavedIconData(): Promise<Record<number, ImageData>> {
	if (savedIconCache) return savedIconCache;

	await ensureOffscreen();

	const rawData = (await browser.runtime.sendMessage({
		target: "offscreen",
		type: "get-saved-icon-data",
	})) as Record<number, SerializedImageData>;

	const result: Record<number, ImageData> = {};
	for (const [size, { width, height, data }] of Object.entries(rawData)) {
		result[Number(size)] = new ImageData(
			new Uint8ClampedArray(data),
			width,
			height,
		);
	}
	savedIconCache = result;
	return result;
}

async function getDefaultPathsForCurrentTheme(): Promise<Record<number, string>> {
	await ensureOffscreen();
	const theme = (await browser.runtime.sendMessage({
		target: "offscreen",
		type: "get-current-theme",
	})) as Theme;
	// User prefers dark UI → toolbar is dark → light-colored icon contrasts against it.
	// User prefers light UI → toolbar is light → dark-colored icon contrasts against it.
	return theme === "dark" ? VARIANT_PATHS.light : VARIANT_PATHS.dark;
}

export function createBrowserSetIcon(): SetIcon {
	return {
		showSaved: async (tabId) => {
			const imageData = await getSavedIconData();
			await browser.action.setIcon({ tabId, imageData });
		},
		showDefault: async (tabId) => {
			const path = await getDefaultPathsForCurrentTheme();
			await browser.action.setIcon({ tabId, path });
		},
	};
}
