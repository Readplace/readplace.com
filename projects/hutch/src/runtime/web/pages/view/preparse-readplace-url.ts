import { MAX_SAVEABLE_URL_LENGTH, type ValidateSaveableUrl } from "@packages/domain/article";
import { originalUrlFromViewPath } from "./view-path";

const VIEW_PREFIX = "/view/";

/** `/view` and `/view/` are the landing route that carries the article in a
 * `?url=` query param; every other `/view/...` path carries it in the path. */
const LANDING_PATHS: ReadonlySet<string> = new Set([VIEW_PREFIX, "/view"]);

/** A Readplace reader URL (`/view/<host>/<path>` or `/view/?url=<encoded>`) wraps
 * an underlying article. Saving the wrapper verbatim would store a self-referential
 * record keyed on Readplace's own host. This recovers the original article URL,
 * recursively collapsing nesting, so the save record, card link, dedup key, and
 * `/view` identity all use the original. */
function initPreparseReadplaceUrl(deps: { selfHost: string }): (rawUrl: string) => string {
	return function preparse(rawUrl: string): string {
		let current = rawUrl;
		/** Each accepted step removes one `/view/<host>` layer, so the URL strictly
		 * shrinks and the loop terminates without a depth cap. A cap would return the
		 * still-wrapped residual past it — the self-referential record this module
		 * exists to prevent. Cost is bounded by the length gate in the decorator. */
		for (;;) {
			let url: URL;
			try {
				url = new URL(current);
			} catch {
				return current;
			}
			if (hostWithoutTrailingDot(url) !== deps.selfHost) return current;
			const original = unwrapSelfViewUrl(url);
			if (original === undefined) return current;
			current = original;
		}
	};
}

/** WHATWG URL keeps a trailing FQDN dot in the hostname (`readplace.com.`) while
 * the SaveableUrl validator strips it, so without normalising here a dotted
 * self-host would skip the unwrap yet still pass validation. */
function hostWithoutTrailingDot(url: URL): string {
	const hostname = url.hostname.endsWith(".") ? url.hostname.slice(0, -1) : url.hostname;
	return url.port === "" ? hostname : `${hostname}:${url.port}`;
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
 * client — mints the brand from the original article URL with no per-route code.
 * The length gate must sit here, before the rewrite: the validator's own
 * MAX_SAVEABLE_URL_LENGTH rule runs only after preparse, too late to bound the
 * unwrap work. An over-length string skips unwrapping and fails validation. */
export function withReadplacePreparse(
	validate: ValidateSaveableUrl,
	deps: { selfHost: string },
): ValidateSaveableUrl {
	const preparse = initPreparseReadplaceUrl(deps);
	return (value) =>
		validate(
			typeof value === "string" && value.length <= MAX_SAVEABLE_URL_LENGTH
				? preparse(value)
				: value,
		);
}
