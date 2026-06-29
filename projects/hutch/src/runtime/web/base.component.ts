import { initBase, initChromelessPage } from "@packages/web-shell";
import { getEnv, requireEnv } from "@packages/require-env";

/** Loaded on every page so an in-browser AI agent discovers Readplace's
 * WebMCP tools (save_link) on load, regardless of which page it landed on. */
const WEBMCP_SCRIPT = `<script src="/client-dist/webmcp.client.js" defer></script>`;

/** Loaded on every page so any server-rendered `<time data-local-time>` baseline
 * (inbox, queue, account) is rewritten into the viewer's local timezone. */
const LOCAL_TIME_SCRIPT = `<script src="/client-dist/local-time.client.js" defer></script>`;

/** Hutch's configured shell renderer. The presentational layout lives in
 * @packages/web-shell; this composition point binds it to hutch's runtime
 * config (the static-asset origin and the dev livereload flag) so every page
 * keeps importing a ready-to-call `Base`. */
export const Base = initBase({
	staticBaseUrl: requireEnv("STATIC_BASE_URL"),
	liveReload: Boolean(getEnv("LIVERELOAD")),
	siteScripts: WEBMCP_SCRIPT + LOCAL_TIME_SCRIPT,
});

/** The shell the iOS app loads the reader through: the same reader content with
 * no logo, nav, or footer, so the native reading list provides the chrome. */
export const ChromelessPage = initChromelessPage({
	staticBaseUrl: requireEnv("STATIC_BASE_URL"),
	liveReload: Boolean(getEnv("LIVERELOAD")),
});
