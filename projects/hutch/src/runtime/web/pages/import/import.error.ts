const IMPORT_ERROR_MESSAGES: Record<string, string> = {
	import_too_large: "That file is too large. The limit is 5 MiB — please get in touch at readplace+migrate@readplace.com to increase the limit.",
	import_no_urls: "We couldn't find any links in that file.",
	import_session_not_found: "That import session has expired. Please upload the file again.",
	import_url_invalid: "That URL can't be crawled — Readplace blocks private-network and non-http(s) addresses.",
	import_url_fetch_failed: "We couldn't fetch that page. It might be down, blocking automated requests, or returned an error. If the page is slow, try saving its HTML and using the upload tab.",
	import_url_unsupported: "That URL doesn't point at an HTML page. Paste a link to an article index or newsletter web view.",
	import_url_too_large: "That page is too large to scan for links.",
	import_url_no_links: "We couldn't find any outbound links on that page.",
};

export type ImportErrorMessageMapping = (query: Record<string, unknown>) => string | undefined;

export const importErrorMessageMapping: ImportErrorMessageMapping = (query) => {
	const errorCode = typeof query.error_code === "string" ? query.error_code : undefined;
	return errorCode ? IMPORT_ERROR_MESSAGES[errorCode] : undefined;
};
