import { createContentSignalMiddleware } from "@packages/web-session";

export const CONTENT_SIGNAL_VALUE = "search=yes, ai-input=yes, ai-train=yes";

/** The sitemap is machine metadata, not a reader-facing page, so it carries no
 * Content-Signal policy and no Accept negotiation. */
const NON_PAGE_PATHS = ["/blog/sitemap.xml"];

export const contentSignalMiddleware = createContentSignalMiddleware({
	value: CONTENT_SIGNAL_VALUE,
	isNonPage: (path) => NON_PAGE_PATHS.includes(path),
});
