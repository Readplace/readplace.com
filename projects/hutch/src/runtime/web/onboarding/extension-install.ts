import type { Request } from "express";
import { ALIVE_COOKIE_NAME, ALIVE_COOKIE_VALUE, SAVE_COOKIE_NAME, SAVE_COOKIE_VALUE } from "@packages/onboarding-extension-signal";
import type { InstallBrowser, Platform } from "./onboarding.types";

const INSTALL_URLS: Record<Platform, string> = {
	firefox: "/install?client=firefox",
	chrome: "/install?client=chrome",
	iphone: "/install?client=iphone",
	other: "/install",
};

const INSTALL_BROWSER_BY_PLATFORM: Record<Platform, InstallBrowser> = {
	firefox: "firefox",
	chrome: "chrome",
	// iPhone has no extension-install CTA on the marketing pages → generic button.
	iphone: "other",
	other: "other",
};

/** True when the extension is actively installed (server-only liveness
 * cookie is present and not yet expired). */
export function isExtensionInstalled(req: Request): boolean {
	return req.cookies?.[ALIVE_COOKIE_NAME] === ALIVE_COOKIE_VALUE;
}

export function isExtensionSavedArticle(req: Request): boolean {
	return req.cookies?.[SAVE_COOKIE_NAME] === SAVE_COOKIE_VALUE;
}

export function detectPlatform(req: Request): Platform {
	const ua = req.headers["user-agent"] ?? "";
	/* Checked first because every iOS browser UA contains "iPhone" while iOS
	 * Chrome/Firefox identify as CriOS/FxiOS (never Chrome//Firefox/), and no
	 * desktop UA contains "iPhone" — so this buckets every iPhone visitor here. */
	if (ua.includes("iPhone")) return "iphone";
	if (ua.includes("Firefox/")) return "firefox";
	if (ua.includes("Chrome/")) return "chrome";
	return "other";
}

/** Extension-install CTA browser for a request, projected from the canonical
 * {@link detectPlatform} so `/` and the A/B landing arms never re-sniff the UA.
 * Falls back to the generic `other` CTA on any device with no installable client
 * (Android — whose Chrome/Firefox can't take our extension — and the
 * unrecognised `other` bucket) so a marketing page never offers a
 * browser-specific "Install" the device can't honour. */
export function detectInstallBrowser(req: Request): InstallBrowser {
	if (!hasInstallableClient(req)) return "other";
	return INSTALL_BROWSER_BY_PLATFORM[detectPlatform(req)];
}

/** True when this device has a first-party client the user can actually
 * install (a browser extension or the iPhone app). False for Android — whose
 * Chrome/Firefox both still match Chrome//Firefox/ in detectPlatform yet
 * cannot install our extension — and for the "other" bucket (desktop Safari,
 * iPad, unrecognised UAs), where the onboarding install step can never
 * complete. Android is read from the raw UA precisely because detectPlatform
 * would otherwise mislabel it "chrome"/"firefox". */
export function hasInstallableClient(req: Request): boolean {
	const ua = req.headers["user-agent"] ?? "";
	if (ua.includes("Android")) return false;
	return detectPlatform(req) !== "other";
}

export function buildExtensionInstallUrl(platform: Platform): string {
	return INSTALL_URLS[platform];
}

export function extensionInstallUrlIfMissing(req: Request): string | undefined {
	const platform = detectPlatform(req);
	/* The reader-page suggestion CTA is extension-specific; iPhone has no
	 * extension, so it must never surface with "extension" wording there. */
	if (platform === "iphone") return undefined;
	if (isExtensionInstalled(req)) return undefined;
	return buildExtensionInstallUrl(platform);
}
