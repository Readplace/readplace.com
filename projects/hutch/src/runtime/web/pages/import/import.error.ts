const IMPORT_ERROR_MESSAGES: Record<string, string> = {
	import_too_large: "That file is too large. The limit is 5 MiB — please get in touch at readplace+migrate@readplace.com to increase the limit.",
	import_no_urls: "We couldn't find any links in that file.",
	import_session_not_found: "That import session has expired. Please upload the file again.",
};

export type ImportErrorMessageMapping = (query: Record<string, unknown>) => string | undefined;

export const importErrorMessageMapping: ImportErrorMessageMapping = (query) => {
	const errorCode = typeof query.error_code === "string" ? query.error_code : undefined;
	return errorCode ? IMPORT_ERROR_MESSAGES[errorCode] : undefined;
};
