import type { UnwrapPreprocessor } from "../../unwrap-preprocessors";
import { originalUrlFromViewPath } from "./view-path";

const VIEW_PREFIX = "/view/";

/** `/view` and `/view/` are the landing route that carries the article in a
 * `?url=` query param; every other `/view/...` path carries it in the path. */
const LANDING_PATHS: ReadonlySet<string> = new Set([VIEW_PREFIX, "/view"]);

/** A Readplace reader URL (`/view/<host>/<path>` or `/view/?url=<encoded>`) wraps
 * an underlying article. Saving the wrapper verbatim would store a self-referential
 * record keyed on Readplace's own host. This recovers the original article URL,
 * recursively collapsing nesting, so the save record, card link, dedup key, and
 * `/view` identity all use the original.
 *
 * Only the `/view` reader forms are recognised: they embed the original URL in the
 * path (or `?url=`) and decode without I/O. The `/queue/:id/view` permalink form
 * carries only an opaque `sha256[:32]` id, so unwrapping it would need an async
 * store lookup — out of scope for this pure, synchronous preprocessor. */
export const readplaceUnwrapPreprocessor: UnwrapPreprocessor = (rawUrl, { selfHost }) => {
	let current = rawUrl;
	/** Each accepted step removes one `/view/<host>` layer, so the URL strictly
	 * shrinks and the loop terminates without a depth cap. A cap would return the
	 * still-wrapped residual past it — the self-referential record this exists to
	 * prevent. Cost is bounded by the length gate in `withUnwrapPreprocessing`. */
	for (;;) {
		let url: URL;
		try {
			url = new URL(current);
		} catch {
			return current;
		}
		if (hostWithoutTrailingDot(url) !== selfHost) return current;
		const original = unwrapSelfViewUrl(url);
		if (original === undefined) return current;
		current = original;
	}
};

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
