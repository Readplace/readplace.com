import { withInternalTracking } from "@packages/web-shell";

export const UPLOAD_ENTRY_HREFS = {
	queueHeader: withInternalTracking("/upload", { source: "queue-listing", content: "upload" }),
	importPage: withInternalTracking("/upload", { source: "import-acquire", content: "upload" }),
	helpAddLinks: withInternalTracking("/upload", { source: "help-add-links", content: "upload" }),
};
