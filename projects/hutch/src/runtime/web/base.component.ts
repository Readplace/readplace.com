import { initBase, initChromelessPage, GlobalNav } from "@packages/web-shell";
import { getEnv, requireEnv } from "@packages/require-env";

/** Loaded on every page so an in-browser AI agent discovers Readplace's
 * WebMCP tools (save_link) on load, regardless of which page it landed on. */
const WEBMCP_SCRIPT = `<script src="/client-dist/webmcp.client.js" defer></script>`;

/** Loaded on every page so any server-rendered `<time data-local-time>` baseline
 * (inbox, queue, account) is rewritten into the viewer's local timezone. */
const LOCAL_TIME_SCRIPT = `<script src="/client-dist/local-time.client.js" defer></script>`;

/** Hutch's configured shell renderer. The presentational layout lives in a
 * separate shell package; this composition point binds it to hutch's runtime
 * config (the static-asset origin and the dev livereload flag) so every page
 * keeps importing a ready-to-call `Base`. */
export const Base = initBase({
	staticBaseUrl: requireEnv("STATIC_BASE_URL"),
	liveReload: Boolean(getEnv("LIVERELOAD")),
	siteScripts: WEBMCP_SCRIPT + LOCAL_TIME_SCRIPT,
	renderNav: GlobalNav,
});

/** The chromeless shell keeps the local-time rewrite but not WebMCP: these pages
 * render inside the app's WKWebView, where there is no in-page AI agent to
 * discover the tools — but there are still server-rendered dates (the reader's
 * crawl bookmark, the account page's trial/cancellation cutoff) that would
 * otherwise freeze at the server's UTC baseline. */
export const ChromelessPage = initChromelessPage({
	staticBaseUrl: requireEnv("STATIC_BASE_URL"),
	liveReload: Boolean(getEnv("LIVERELOAD")),
	siteScripts: LOCAL_TIME_SCRIPT,
});
