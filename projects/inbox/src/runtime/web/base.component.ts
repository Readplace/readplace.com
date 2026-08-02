import { initBase, GlobalBoostedNav } from "@packages/web-shell";
import { getEnv, requireEnv } from "@packages/require-env";

/** Loaded on every page so an in-browser AI agent discovers Readplace's
 * WebMCP tools (save_link) on load, regardless of which page it landed on.
 * Served by hutch on the same origin. */
const WEBMCP_SCRIPT = `<script src="/client-dist/webmcp.client.js" defer></script>`;

/** Loaded on every page so any server-rendered `<time data-local-time>` baseline
 * is rewritten into the viewer's local timezone. Served by hutch on the same
 * origin. */
const LOCAL_TIME_SCRIPT = `<script src="/client-dist/local-time.client.js" defer></script>`;

/** The inbox deployable's configured shell renderer. The presentational layout
 * lives in a separate shell package; this composition point binds it to this
 * runtime's config (the static-asset origin and the dev livereload flag) so
 * every page keeps importing a ready-to-call `Base`. */
export const Base = initBase({
	staticBaseUrl: requireEnv("STATIC_BASE_URL"),
	liveReload: Boolean(getEnv("LIVERELOAD")),
	siteScripts: WEBMCP_SCRIPT + LOCAL_TIME_SCRIPT,
	renderNav: GlobalBoostedNav,
});
