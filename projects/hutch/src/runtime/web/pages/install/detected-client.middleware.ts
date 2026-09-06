import type { Request, RequestHandler } from "express";
import { isbot } from "isbot";
import { suppressClickCount } from "@packages/web-analytics";
import type { ClientName } from "@packages/supported-clients";
import { wantsMarkdown } from "@packages/web-shell";
import { detectPlatform } from "../../onboarding/extension-install";
import type { Platform } from "../../onboarding/onboarding.types";
import { revealsHiddenTabs } from "./install.component";

/**
 * 1. Every browser on the phone, not just the platform default: our extension
 *    installs on neither phone OS, so the app is the only first-party client any
 *    of their browsers can take.
 * 2. Desktop Safari, iPad, and anything unrecognised carry no first-party client
 *    either; the MCP connector is the one route open to all of them.
 */
const CLIENT_BY_SURFACE = {
	firefox: "firefox",
	chrome: "chrome",
	iphone: "iphone", /* 1 */
	android: "android", /* 1 */
	other: "chatgpt", /* 2 */
} satisfies Record<Platform, ClientName>;

const ANDROID_WHILE_TAB_HIDDEN: ClientName = "gemini";

const PARSE_ORIGIN = "https://install.invalid";

function detectedClient(req: Request): ClientName {
	const platform = detectPlatform(req);
	if (platform === "android" && !revealsHiddenTabs(req.query.feature)) return ANDROID_WHILE_TAB_HIDDEN;
	return CLIENT_BY_SURFACE[platform];
}

/** Carries the incoming query through, so the campaign params on the links into
 * this page survive the hop. */
function withDetectedClient(originalUrl: string, client: ClientName): string {
	const url = new URL(originalUrl, PARSE_ORIGIN);
	url.searchParams.set("client", client);
	return `${url.pathname}${url.search}`;
}

/**
 * 1. The absence of the param, not its falsiness: `?client=` is a 400 today and
 *    must stay one, and testing for absence is what makes a loop unreachable —
 *    every Location this emits carries a client.
 * 2. A markdown client asked for a representation, not a browser page.
 * 3. Googlebot's UA carries a Chrome/ token, so without this the sitemap's own
 *    canonical would answer a crawler with a redirect. Crawlers are the only
 *    readers left that still see the bare page.
 * 4. The hop and the page it lands on both carry the inbound utm_medium=internal,
 *    and a 302 is under the status ceiling the click counter rejects at, so
 *    without this one navigation is recorded as two clicks.
 */
export const redirectToDetectedClient: RequestHandler = (req, res, next) => {
	if (req.query.client !== undefined) return next(); /* 1 */
	if (wantsMarkdown(req)) return next(); /* 2 */
	if (isbot(req.get("user-agent"))) return next(); /* 3 */
	res.vary("User-Agent");
	suppressClickCount(res); /* 4 */
	res.redirect(302, withDetectedClient(req.originalUrl, detectedClient(req)));
};
