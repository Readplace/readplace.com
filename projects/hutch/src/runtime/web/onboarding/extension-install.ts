import type { Request } from "express";
import { ALIVE_COOKIE_NAME, ALIVE_COOKIE_VALUE, SAVE_COOKIE_NAME, SAVE_COOKIE_VALUE } from "@packages/onboarding-extension-signal";
import { SUPPORTED_CLIENTS } from "@packages/supported-clients";
import type { ClientName, ClientNameInCategory } from "@packages/supported-clients";
import type { InstallBrowser, InstallSurface, Platform } from "./onboarding.types";

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

/**
 * 1. iPhone holds the lowest rank because every iOS browser UA contains "iPhone"
 *    while iOS Chrome/Firefox identify as CriOS/FxiOS (never Chrome//Firefox/),
 *    and no desktop UA contains "iPhone" — so it buckets every iPhone visitor
 *    before a desktop token can claim them.
 * 2. `chrome` names the client a visitor can INSTALL, not the browser engine
 *    they run: Edge, Opera, Samsung Internet and Brave all resolve here because
 *    the Chrome Web Store serves them all. The analytics browser families are a
 *    different axis and deliberately keep those apart, so the same visitor is
 *    `chrome` to this module and `edge` to that one.
 */
const UA_SIGNATURES = {
	iphone: { token: "iPhone", rank: 0 }, /* 1 */
	firefox: { token: "Firefox/", rank: 1 },
	chrome: { token: "Chrome/", rank: 2 }, /* 2 */
} satisfies Record<ClientNameInCategory<"contentCapture">, { token: string; rank: number }>;

function isDetectable(name: ClientName): name is keyof typeof UA_SIGNATURES {
	return name in UA_SIGNATURES;
}

const DETECTION_ORDER = SUPPORTED_CLIENTS.flatMap((client) =>
	isDetectable(client.name) ? [client.name] : [],
).sort((a, b) => UA_SIGNATURES[a].rank - UA_SIGNATURES[b].rank);

export function detectPlatform(req: Request): Platform {
	const ua = req.headers["user-agent"] ?? "";
	return DETECTION_ORDER.find((name) => ua.includes(UA_SIGNATURES[name].token)) ?? "other";
}

/** Extension-install CTA browser for a request, projected from the canonical
 * {@link detectPlatform} so `/` and the A/B landing arms never re-sniff the UA.
 * Falls back to the generic `other` CTA on any device with no installable client
 * (Android — whose Chrome/Firefox can't take our extension — and the
 * unrecognised `other` bucket) so a marketing page never offers a
 * browser-specific "Install" the device can't honour. */
export function detectInstallBrowser(req: Request): InstallBrowser {
	return INSTALL_BROWSER_BY_PLATFORM[installablePlatform(req)];
}

/** {@link detectPlatform} narrowed to what this device can actually install, so
 * every caller inherits the Android exclusion instead of having to remember it. */
export function installablePlatform(req: Request): Platform {
	if (!hasInstallableClient(req)) return "other";
	return detectPlatform(req);
}

/** True when this device has a first-party client the user can actually
 * install (a browser extension or the iPhone app). False for Android — whose
 * Chrome/Firefox both still match Chrome//Firefox/ in detectPlatform yet
 * cannot install our extension — and for the "other" bucket (desktop Safari,
 * iPad, unrecognised UAs), where the onboarding install step can never
 * complete. Android is read from the raw UA precisely because detectPlatform
 * would otherwise mislabel it "chrome"/"firefox". */
export function hasInstallableClient(req: Request): boolean {
	if (isAndroid(req)) return false;
	return detectPlatform(req) !== "other";
}

export function isAndroid(req: Request): boolean {
	return (req.headers["user-agent"] ?? "").includes("Android");
}

/** Where a visitor is reading from, for surfaces that must answer for every
 * device rather than only the ones carrying a first-party client. Android earns
 * a name of its own here — {@link detectPlatform} mislabels it `chrome`/`firefox`
 * and {@link installablePlatform} folds it into `other`, yet it is neither. */
export function detectInstallSurface(req: Request): InstallSurface {
	const platform = detectPlatform(req);
	if (platform === "iphone") return "iphone";
	if (isAndroid(req)) return "android";
	return platform;
}

export function buildExtensionInstallUrl(platform: Platform): string {
	return INSTALL_URLS[platform];
}

const NATIVE_APP_PLATFORMS: ReadonlySet<Platform> = new Set(
	SUPPORTED_CLIENTS.flatMap((client) => (client.group === "nativeApp" ? [client.name] : [])),
);

export function extensionInstallUrlIfMissing(req: Request): string | undefined {
	const platform = installablePlatform(req);
	/* The reader-page suggestion CTA is extension-specific; native-app platforms
	 * have no extension, so it must never surface with "extension" wording there. */
	if (NATIVE_APP_PLATFORMS.has(platform)) return undefined;
	if (isExtensionInstalled(req)) return undefined;
	return buildExtensionInstallUrl(platform);
}
