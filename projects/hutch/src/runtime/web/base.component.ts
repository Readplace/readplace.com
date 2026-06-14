import { initBase } from "@packages/web-shell";
import { getEnv, requireEnv } from "../domain/require-env";

/** Hutch's configured shell renderer. The presentational layout lives in
 * @packages/web-shell; this composition point binds it to hutch's runtime
 * config (the static-asset origin and the dev livereload flag) so every page
 * keeps importing a ready-to-call `Base`. */
export const Base = initBase({
	staticBaseUrl: requireEnv("STATIC_BASE_URL"),
	liveReload: Boolean(getEnv("LIVERELOAD")),
});
