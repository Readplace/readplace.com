import type { Request } from "express";
import { ALIVE_COOKIE_NAME, ALIVE_COOKIE_VALUE, SAVE_COOKIE_NAME, SAVE_COOKIE_VALUE } from "@packages/onboarding-extension-signal";
import type { Platform } from "./onboarding.types";

const INSTALL_URLS: Record<Platform, string> = {
	firefox: "/install?client=firefox",
	chrome: "/install?client=chrome",
	iphone: "/install?client=iphone",
	other: "/install",
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
