import type { Request } from "express";

/** Header the iOS app sets on every authenticated Siren request. Safari on the
 * same phone can't read the app's cookies, so the server tells an app request
 * apart from Safari by this header and tracks onboarding completion per-user
 * server-side instead of via cookies. */
export const IOS_CLIENT_HEADER = "x-readplace-client";
export const IOS_CLIENT_VALUE = "ios";

/** True when the request came from the iOS app. An absent header reads as
 * non-iOS, so older shipped app builds and the browser extension — which never
 * send it — are tolerated as non-iOS. */
export function isIosClient(req: Request): boolean {
	return req.get(IOS_CLIENT_HEADER) === IOS_CLIENT_VALUE;
}

/** Query param the app carries on an href it opens in its web sheet, since the
 * WKWebView cannot attach {@link IOS_CLIENT_HEADER} to a page load or a form post. */
export const IOS_PLATFORM_QUERY = "platform";

export const APP_SHELL_QUERY = "shell";
export const APP_SHELL_VALUE = "app";

/** True when the page is hosted by the app's in-app web sheet — a WKWebView whose
 * navigation delegate intercepts `readplace://` deep links. The app appends this
 * itself; the server never advertises it. A store build that predates the marker —
 * which cannot deploy in lockstep with the server — keeps the full web shell and its
 * ordinary redirects rather than being handed a control it cannot execute. */
export function isAppShell(req: Request): boolean {
	return req.query[APP_SHELL_QUERY] === APP_SHELL_VALUE;
}

/** True when a request should render the iOS app surface. The app's WKWebView
 * follows server-advertised hrefs but — unlike the native Siren URLSession —
 * cannot attach the client header to those page loads or their form posts, so a
 * `?platform=ios` query param carried on the href is the only marker an in-app
 * web page sees. The header is honoured alongside it for native Siren requests
 * (e.g. the queue collection that publishes the account href). The app shell is
 * only ever the iOS app, so it implies the surface without the app having to
 * carry both markers. */
export function isIosSurface(req: Request): boolean {
	if (isAppShell(req)) return true;
	return req.query[IOS_PLATFORM_QUERY] === IOS_CLIENT_VALUE || isIosClient(req);
}
