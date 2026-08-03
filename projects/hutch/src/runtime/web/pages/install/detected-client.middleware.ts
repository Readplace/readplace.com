import type { RequestHandler } from "express";
import { isbot } from "isbot";
import { suppressClickCount } from "@packages/web-analytics";
import { wantsMarkdown } from "@packages/web-shell";
import { installablePlatform } from "../../onboarding/extension-install";
import type { Platform } from "../../onboarding/onboarding.types";
import type { InstallClient } from "./install.component";

/**
 * 1. Chrome is already what a bare /install renders, so redirecting it would buy
 *    a round trip and nothing else.
 * 2. iPhone has the same defect as Firefox but has not been reported; it becomes
 *    a one-word change here when it is.
 */
const CLIENT_BY_PLATFORM = {
	firefox: "firefox",
	chrome: undefined, /* 1 */
	iphone: undefined, /* 2 */
	other: undefined,
} satisfies Record<Platform, InstallClient | undefined>;

const PARSE_ORIGIN = "https://install.invalid";

/** Carries the incoming query through, so the campaign params on the links into
 * this page survive the hop. */
function withDetectedClient(originalUrl: string, client: InstallClient): string {
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
 *    canonical would answer a crawler with a redirect.
 * 4. Set before the branch below: the fall-through 200 is UA-dependent too, so a
 *    cache holding one browser's copy must not serve it to another.
 * 5. The hop and the page it lands on both carry the inbound utm_medium=internal,
 *    and a 302 is under the status ceiling the click counter rejects at, so
 *    without this one nav is recorded as two clicks.
 */
export const redirectToDetectedClient: RequestHandler = (req, res, next) => {
	if (req.query.client !== undefined) return next(); /* 1 */
	if (wantsMarkdown(req)) return next(); /* 2 */
	if (isbot(req.get("user-agent"))) return next(); /* 3 */
	res.vary("User-Agent"); /* 4 */
	const client = CLIENT_BY_PLATFORM[installablePlatform(req)];
	if (client === undefined) return next();
	suppressClickCount(res); /* 5 */
	res.redirect(302, withDetectedClient(req.originalUrl, client));
};
