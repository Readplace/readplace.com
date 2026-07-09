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

/** True when a request should render the iOS app surface. The app's WKWebView
 * follows server-advertised hrefs but — unlike the native Siren URLSession —
 * cannot attach the client header to those page loads or their form posts, so a
 * `?platform=ios` query param carried on the href is the only marker an in-app
 * web page sees. The header is honoured alongside it for native Siren requests
 * (e.g. the queue collection that publishes the account href). */
export function isIosSurface(req: Request): boolean {
	return req.query.platform === IOS_CLIENT_VALUE || isIosClient(req);
}
