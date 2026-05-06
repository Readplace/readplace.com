import type { Request } from "express";
import { COOKIE_NAME, COOKIE_VALUE, SAVE_COOKIE_NAME, SAVE_COOKIE_VALUE } from "@packages/onboarding-extension-signal";
import type { BrowserName } from "./onboarding.types";

const INSTALL_URLS: Record<BrowserName, string> = {
	firefox: "/install?browser=firefox",
	chrome: "/install?browser=chrome",
	other: "/install",
};

export function isExtensionInstalled(req: Request): boolean {
	return req.cookies?.[COOKIE_NAME] === COOKIE_VALUE;
}

export function isExtensionSavedArticle(req: Request): boolean {
	return req.cookies?.[SAVE_COOKIE_NAME] === SAVE_COOKIE_VALUE;
}

export function detectBrowser(req: Request): BrowserName {
	const ua = req.headers["user-agent"] ?? "";
	if (ua.includes("Firefox/")) return "firefox";
	if (ua.includes("Chrome/")) return "chrome";
	return "other";
}

export function buildExtensionInstallUrl(browser: BrowserName): string {
	return INSTALL_URLS[browser];
}

/** Install URL the reader-failed slot should link to, or undefined when the user already has the extension. */
export function extensionInstallUrlIfMissing(req: Request): string | undefined {
	if (isExtensionInstalled(req)) return undefined;
	return buildExtensionInstallUrl(detectBrowser(req));
}
