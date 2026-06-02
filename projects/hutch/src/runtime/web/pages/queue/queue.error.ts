const SAVE_ERROR_MESSAGES: Record<string, string> = {
	save_failed: "Could not save article. Please try again.",
};

export type HttpErrorMessageMapping = (query: Record<string, unknown>) => string | undefined;

export const httpErrorMessageMapping: HttpErrorMessageMapping = (query) => {
	const errorCode = typeof query.error_code === "string" ? query.error_code : undefined;
	return errorCode ? SAVE_ERROR_MESSAGES[errorCode] : undefined;
};

export interface StatusFlash {
	message: string;
	undoArticleId: string;
	undoStatus: "read" | "unread";
}

/** Reads the one-shot params the POST /:id/status redirect appends so the
 * queue page can confirm the change with a toast and offer a working Undo
 * that posts the opposite status back. */
export const statusFlashMapping = (
	query: Record<string, unknown>,
): StatusFlash | undefined => {
	const changed = query.status_changed;
	const articleId = query.status_article;
	if (changed !== "read" && changed !== "unread") return undefined;
	if (typeof articleId !== "string" || articleId.length === 0) return undefined;
	return {
		message: changed === "read" ? "Marked as read" : "Marked as unread",
		undoArticleId: articleId,
		undoStatus: changed === "read" ? "unread" : "read",
	};
};

export type ImportFlashMapping = (query: Record<string, unknown>) => string | undefined;

export const importFlashMapping: ImportFlashMapping = (query) => {
	const importedRaw = query.import_imported;
	const totalRaw = query.import_total;
	if (typeof importedRaw !== "string" || typeof totalRaw !== "string") return undefined;
	const imported = Number.parseInt(importedRaw, 10);
	const total = Number.parseInt(totalRaw, 10);
	if (!Number.isFinite(imported) || !Number.isFinite(total)) return undefined;
	const skippedRaw = query.import_skipped;
	const skipped =
		typeof skippedRaw === "string" ? Number.parseInt(skippedRaw, 10) : 0;
	const base = `Imported ${imported} of ${total} link${total === 1 ? "" : "s"}.`;
	if (Number.isFinite(skipped) && skipped > 0) {
		return `${base} Skipped ${skipped} link${skipped === 1 ? "" : "s"} that couldn't be imported.`;
	}
	return base;
};
