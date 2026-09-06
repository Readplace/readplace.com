import type { Request } from "express";
import { ALIVE_COOKIE_NAME, ALIVE_COOKIE_VALUE, SAVE_COOKIE_NAME, SAVE_COOKIE_VALUE } from "@packages/onboarding-extension-signal";
import { ADVERTISED_CLIENTS, clientCategoryOfGroup, SUPPORTED_CLIENTS } from "@packages/supported-clients";
import type { AdvertisedClientNameInCategory, ClientName, ClientNameInCategory } from "@packages/supported-clients";
import type { Platform } from "./onboarding.types";

const INSTALL_URLS: Record<Platform, string> = {
	firefox: "/install?client=firefox",
	chrome: "/install?client=chrome",
	iphone: "/install?client=iphone",
	android: "/install?client=android",
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

/**
 * 1. The phone tokens hold the lowest ranks because every mobile browser UA
 *    carries its platform token — "iPhone", or "Android" — while the mobile
 *    Chrome/Firefox builds also carry Chrome//Firefox/ (iOS uses CriOS/FxiOS,
 *    which match neither), and no desktop UA carries either platform token. So
 *    they bucket every phone visitor before a desktop token can claim them.
 * 2. `chrome` names the client a visitor can INSTALL, not the browser engine
 *    they run: Edge, Opera, Samsung Internet and Brave all resolve here because
 *    the Chrome Web Store serves them all. The analytics browser families are a
 *    different axis and deliberately keep those apart, so the same visitor is
 *    `chrome` to this module and `edge` to that one.
 */
const UA_SIGNATURES = {
	iphone: { token: "iPhone", rank: 0 }, /* 1 */
	android: { token: "Android", rank: 1 }, /* 1 */
	firefox: { token: "Firefox/", rank: 2 },
	chrome: { token: "Chrome/", rank: 3 }, /* 2 */
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

const ADVERTISED_INSTALLABLE_NAMES: ReadonlySet<string> = new Set(
	ADVERTISED_CLIENTS.flatMap((client) =>
		clientCategoryOfGroup(client.group) === "contentCapture" ? [client.name] : [],
	),
);

/** The platforms a pitch may address: the advertised content-capture clients,
 * plus the `other` bucket every unrecognised device falls into. */
export type PitchablePlatform = AdvertisedClientNameInCategory<"contentCapture"> | "other";

function isAdvertisedInstallable(
	name: Exclude<Platform, "other">,
): name is Exclude<PitchablePlatform, "other"> {
	return ADVERTISED_INSTALLABLE_NAMES.has(name);
}

/**
 * The advertised client this device runs, or undefined when there is nothing
 * Readplace may offer it. A client that is built but not advertised reads as
 * not existing: the moment its flag flips, every surface gated through here
 * starts addressing that platform without another edit.
 */
export function advertisedPlatformOf(req: Request): Exclude<PitchablePlatform, "other"> | undefined {
	const platform = detectPlatform(req);
	if (platform === "other") return undefined;
	return isAdvertisedInstallable(platform) ? platform : undefined;
}

/** True when this device has a first-party client the visitor can actually go
 * and install right now. False for the "other" bucket (desktop Safari, iPad,
 * unrecognised UAs) and for a platform whose only client is not advertised —
 * an app with no store listing is not installable in any sense a pitch may
 * rely on. */
export function hasInstallableClient(req: Request): boolean {
	return advertisedPlatformOf(req) !== undefined;
}

// A pitch, not a status: the install pitch renders only where the visitor could
// act on it — they already hold the extension, or their platform has an
// advertised client to go and get. An Android reader saw this for a month
// offering two installs their device could not perform.
export function canOfferExtensionInstall(req: Request): boolean {
	return isExtensionInstalled(req) || hasInstallableClient(req);
}

export function buildExtensionInstallUrl(platform: Platform): string {
	return INSTALL_URLS[platform];
}

const NATIVE_APP_PLATFORMS: ReadonlySet<Platform> = new Set(
	SUPPORTED_CLIENTS.flatMap((client) => (client.group === "nativeApp" ? [client.name] : [])),
);

export function extensionInstallUrlIfMissing(req: Request): string | undefined {
	const platform = detectPlatform(req);
	/* The reader-page suggestion CTA is extension-specific; native-app platforms
	 * have no extension, so it must never surface with "extension" wording there. */
	if (NATIVE_APP_PLATFORMS.has(platform)) return undefined;
	if (isExtensionInstalled(req)) return undefined;
	return buildExtensionInstallUrl(platform);
}
