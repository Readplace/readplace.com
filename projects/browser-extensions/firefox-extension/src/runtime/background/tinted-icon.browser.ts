import type { SetIcon } from "browser-extension-core";

const SAVED_COLOR = "#3D8B6E";
const NEEDS_CAPTURE_COLOR = "#c8702a";
const ICON_SIZES = [16, 32, 48, 64] as const;

async function tintIcon(size: number, color: string): Promise<ImageData> {
	// Tint the dark-colored variant — it has no halo, so the source-in composite
	// produces a cleanly-tinted shape without a colored halo around it.
	const url = browser.runtime.getURL(`icons/dark/icon-${size}.png`);
	const response = await fetch(url);
	const blob = await response.blob();
	const bitmap = await createImageBitmap(blob);

	const canvas = new OffscreenCanvas(size, size);
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Failed to get canvas context");
	}

	ctx.drawImage(bitmap, 0, 0, size, size);
	ctx.globalCompositeOperation = "source-in";
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, size, size);

	return ctx.getImageData(0, 0, size, size);
}

const tintedIconCache = new Map<string, Record<number, ImageData>>();

async function getTintedIconData(
	color: string,
): Promise<Record<number, ImageData>> {
	const cached = tintedIconCache.get(color);
	if (cached) return cached;
	const entries = await Promise.all(
		ICON_SIZES.map(
			async (size) => [size, await tintIcon(size, color)] as const,
		),
	);
	const tinted = Object.fromEntries(entries);
	tintedIconCache.set(color, tinted);
	return tinted;
}

export function createBrowserSetIcon(): SetIcon {
	return {
		showSaved: async (tabId) => {
			const imageData = await getTintedIconData(SAVED_COLOR);
			await browser.browserAction.setIcon({ tabId, imageData });
		},
		showNeedsCapture: async (tabId) => {
			const imageData = await getTintedIconData(NEEDS_CAPTURE_COLOR);
			await browser.browserAction.setIcon({ tabId, imageData });
		},
		showDefault: async (tabId) => {
			// Pass no path/imageData so Firefox falls back to the manifest's
			// browser_action.theme_icons, which adapts to the active browser theme.
			await browser.browserAction.setIcon({ tabId });
		},
	};
}
