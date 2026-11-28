import { createContentSignalMiddleware } from "@packages/web-session";

export const CONTENT_SIGNAL_VALUE = "search=yes, ai-input=yes, ai-train=no";

const NON_PAGE_PATHS = ["/icon.svg", "/icon-small.svg", "/embed.client.js"];

export const contentSignalMiddleware = createContentSignalMiddleware({
	value: CONTENT_SIGNAL_VALUE,
	isNonPage: (path) => NON_PAGE_PATHS.includes(path),
});
