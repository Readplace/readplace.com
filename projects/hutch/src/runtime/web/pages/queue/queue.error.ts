import type { Request } from "express";

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

/** The confirmation toast a status change earns: message plus an Undo posting
 * the opposite status. Built here from the applied change so the 303 flash path
 * (statusFlashMapping) and the htmx card path (which knows the change directly)
 * can't drift on wording or the undo direction. */
export function statusFlashFor(input: {
	articleId: string;
	changed: "read" | "unread";
}): StatusFlash {
	return {
		message: input.changed === "read" ? "Marked as read" : "Marked as unread",
		undoArticleId: input.articleId,
		undoStatus: input.changed === "read" ? "unread" : "read",
	};
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
	return statusFlashFor({ articleId, changed });
};

/** Pulls the one-shot status flash params off the query so an intervening
 * redirect — e.g. the out-of-bounds page clamp in GET /queue — carries the Undo
 * toast across the extra hop. statusFlashMapping renders them. */
export function collectStatusFlashParams(query: Request["query"]): [string, string][] {
	return (["status_changed", "status_article"] as const).flatMap((key): [string, string][] => {
		const value = query[key];
		return typeof value === "string" ? [[key, value]] : [];
	});
}

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
