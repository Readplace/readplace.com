import { withInternalTracking } from "@packages/web-shell";

export const UPLOAD_ENTRY_HREFS = {
	addArticleFallback: withInternalTracking("/upload", { source: "queue-add-article", content: "upload" }),
	importNoScript: withInternalTracking("/upload", { source: "import-noscript", content: "upload" }),
	helpAddLinks: withInternalTracking("/upload", { source: "help-add-links", content: "upload" }),
};
