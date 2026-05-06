const SAVE_ERROR_MESSAGES: Record<string, string> = {
	save_failed: "Could not save article. Please try again.",
	import_too_large: "That file is too large. The limit is 5 MiB — please email it to hutch+migrate@readplace.com instead.",
	import_no_urls: "We couldn't find any links in that file.",
	import_session_not_found: "That import session has expired. Please upload the file again.",
};

export type HttpErrorMessageMapping = (query: Record<string, unknown>) => string | undefined;

export const httpErrorMessageMapping: HttpErrorMessageMapping = (query) => {
	const errorCode = typeof query.error_code === "string" ? query.error_code : undefined;
	return errorCode ? SAVE_ERROR_MESSAGES[errorCode] : undefined;
};

export type ImportFlashMapping = (query: Record<string, unknown>) => string | undefined;

export const importFlashMapping: ImportFlashMapping = (query) => {
	const importedRaw = query.import_imported;
	const totalRaw = query.import_total;
	if (typeof importedRaw !== "string" || typeof totalRaw !== "string") return undefined;
	const imported = Number.parseInt(importedRaw, 10);
	const total = Number.parseInt(totalRaw, 10);
	if (!Number.isFinite(imported) || !Number.isFinite(total)) return undefined;
	return `Imported ${imported} of ${total} link${total === 1 ? "" : "s"}.`;
};
