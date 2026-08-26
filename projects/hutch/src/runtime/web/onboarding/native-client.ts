import type { Request } from "express";

/** Header a native app sets on every authenticated Siren request. A browser on
 * the same phone can't read the app's cookies, so the server tells an app
 * request apart from that browser by this header and tracks onboarding
 * completion per-user server-side instead of via cookies. */
export const NATIVE_CLIENT_HEADER = "x-readplace-client";

/**
 * The wire value each shipped native app sends, deliberately NOT derived from
 * its client slug — the iPhone client is `iphone` in the roster but ships `ios`
 * here. These strings are baked into released app binaries, so they are data.
 */
export const NATIVE_CLIENT_VALUES = ["ios", "android"] as const;

export type NativeClientPlatform = (typeof NATIVE_CLIENT_VALUES)[number];

const NATIVE_CLIENT_VALUE_SET: ReadonlySet<string> = new Set(NATIVE_CLIENT_VALUES);

function isNativeClientPlatform(value: unknown): value is NativeClientPlatform {
	return typeof value === "string" && NATIVE_CLIENT_VALUE_SET.has(value);
}

/** Which native app sent this request, or undefined for anything else. An absent
 * or unrecognised header reads as non-native, so older shipped app builds and the
 * browser extensions — which never send it — are tolerated as non-native. */
export function nativeClientOf(req: Request): NativeClientPlatform | undefined {
	const value = req.get(NATIVE_CLIENT_HEADER);
	return isNativeClientPlatform(value) ? value : undefined;
}

export function isNativeClient(req: Request): boolean {
	return nativeClientOf(req) !== undefined;
}

/** Header an app build sets once it finishes the content upload on a transport
 * that outlives the share sheet. The server never advertises it, so a shipped
 * build that predates the marker still gets the "don't close this" notice — for
 * that build it is still true. */
export const SAVE_CONTINUITY_HEADER = "x-readplace-save-continuity";
export const SAVE_CONTINUITY_BACKGROUND = "background";

export function hasBackgroundSaveContinuity(req: Request): boolean {
	return req.get(SAVE_CONTINUITY_HEADER) === SAVE_CONTINUITY_BACKGROUND;
}

/** Query param an app carries on an href it opens in its web sheet, since the
 * embedded web view cannot attach {@link NATIVE_CLIENT_HEADER} to a page load or
 * a form post. */
export const PLATFORM_QUERY = "platform";

export const APP_SHELL_QUERY = "shell";
export const APP_SHELL_VALUE = "app";

/** True when the page is hosted by an app's in-app web sheet — a web view whose
 * navigation delegate intercepts `readplace://` deep links. The app appends this
 * itself; the server never advertises it. A store build that predates the marker —
 * which cannot deploy in lockstep with the server — keeps the full web shell and its
 * ordinary redirects rather than being handed a control it cannot execute. The
 * marker names no platform: every app's sheet intercepts the same deep links. */
export function isAppShell(req: Request): boolean {
	return req.query[APP_SHELL_QUERY] === APP_SHELL_VALUE;
}

/** Which native app's surface should render, or undefined for the web. The app's
 * web view follows server-advertised hrefs but — unlike the native Siren
 * requests — cannot attach the client header to those page loads or their form
 * posts, so the `?platform=` marker carried on the href is the only signal an
 * in-app web page sees. The header is honoured alongside it for native Siren
 * requests (e.g. the queue collection that publishes the account href). */
export function nativeSurfaceOf(req: Request): NativeClientPlatform | undefined {
	const queried = req.query[PLATFORM_QUERY];
	if (isNativeClientPlatform(queried)) return queried;
	return nativeClientOf(req);
}

/** True when a request should render a native app surface at all. The app shell
 * implies one without the app having to carry both markers, which is what keeps a
 * shipped build that sends only `?shell=app` on the app surface. */
export function isNativeSurface(req: Request): boolean {
	if (isAppShell(req)) return true;
	return nativeSurfaceOf(req) !== undefined;
}
