import type { ValidateSaveableUrl } from "@packages/domain/article";
import { MAX_VIEW_UNWRAP_DEPTH, originalUrlFromViewPath } from "./view-path";

const VIEW_PREFIX = "/view/";

/** `/view` and `/view/` are the landing route that carries the article in a
 * `?url=` query param; every other `/view/...` path carries it in the path. */
const LANDING_PATHS: ReadonlySet<string> = new Set([VIEW_PREFIX, "/view"]);

/** A Readplace reader URL (`/view/<host>/<path>` or `/view/?url=<encoded>`) wraps
 * an underlying article. Saving the wrapper verbatim would store a self-referential
 * record keyed on Readplace's own host. This recovers the original article URL,
 * recursively collapsing nesting, so the save record, card link, dedup key, and
 * `/view` identity all use the original. */
export function initPreparseReadplaceUrl(deps: { selfHost: string }): (rawUrl: string) => string {
	return function preparse(rawUrl: string): string {
		let current = rawUrl;
		for (let depth = 0; depth < MAX_VIEW_UNWRAP_DEPTH; depth += 1) {
			let url: URL;
			try {
				url = new URL(current);
			} catch {
				return current;
			}
			if (url.host !== deps.selfHost) return current;
			const original = unwrapSelfViewUrl(url);
			if (original === undefined) return current;
			current = original;
		}
		return current;
	};
}

function unwrapSelfViewUrl(url: URL): string | undefined {
	if (LANDING_PATHS.has(url.pathname)) {
		const param = url.searchParams.get("url");
		return param === null ? undefined : param;
	}
	if (url.pathname.startsWith(VIEW_PREFIX)) {
		return originalUrlFromViewPath(url.pathname.slice(VIEW_PREFIX.length));
	}
	return undefined;
}

/** Decorates a SaveableUrl validator so it unwraps Readplace self-URLs before
 * validating. Composed at the composition roots so every save path — every
 * client — mints the brand from the original article URL with no per-route code. */
export function withReadplacePreparse(
	validate: ValidateSaveableUrl,
	deps: { selfHost: string },
): ValidateSaveableUrl {
	const preparse = initPreparseReadplaceUrl(deps);
	return (value) => validate(typeof value === "string" ? preparse(value) : value);
}
