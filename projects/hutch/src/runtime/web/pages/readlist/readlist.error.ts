import { SaveableUrlErrorCodeSchema, type SaveableUrlErrorCode } from "@packages/domain/article";
import {
	READLIST_LABEL_MAX_LENGTH,
	READLIST_MAX_PER_USER,
	READLIST_PURPOSE_MAX_LENGTH,
	type ReadlistCreateRejection,
	type ReadlistRenameRejection,
} from "@packages/domain/readlist";
import type { Request } from "express";

const SAVE_ERROR_MESSAGES: Record<string, string> = {
	save_failed: "Couldn't save this article. Try again.",
};

const SAVEABLE_URL_REJECTION_COPY: Record<
	SaveableUrlErrorCode,
	{ fieldMessage: string; skippedLabel: string }
> = {
	malformed_url: {
		fieldMessage: "Enter a valid article link.",
		skippedLabel: "Invalid link",
	},
	unsupported_scheme: {
		fieldMessage: "Only http:// and https:// links are supported.",
		skippedLabel: "Unsupported link",
	},
	private_network: {
		fieldMessage: "Private or local network links can't be saved.",
		skippedLabel: "Private or local network link",
	},
};

export function saveFormRejectionMessage(code: SaveableUrlErrorCode): string {
	return SAVEABLE_URL_REJECTION_COPY[code].fieldMessage;
}

export function skippedLinkReasonLabel(code: SaveableUrlErrorCode): string {
	return SAVEABLE_URL_REJECTION_COPY[code].skippedLabel;
}

export const READLIST_ERROR_LIMIT = "limit";

export const READLIST_ERROR_UNKNOWN_READLIST = "unknown_readlist";

export const READLIST_NOTICE_SAVE_QUEUED = "save_queued";

const READLIST_ERROR_MESSAGES: Record<string, string> = {
	[READLIST_ERROR_LIMIT]: `You can keep up to ${READLIST_MAX_PER_USER} readlists.`,
	[READLIST_ERROR_UNKNOWN_READLIST]: "That readlist no longer exists.",
};

const READLIST_NAME_LENGTH_MESSAGE = `Give the readlist a name of ${READLIST_LABEL_MAX_LENGTH} characters or fewer.`;

export const READLIST_LIMIT_MESSAGE = `You can create up to ${READLIST_MAX_PER_USER} readlists. Delete an existing readlist before creating a new one.`;

export type ReadlistCreateDialogRejection = ReadlistCreateRejection | "name-taken";

export const READLIST_CREATE_REJECTIONS: Record<
	ReadlistCreateDialogRejection,
	{ status: 422; error: ReadlistCreateDialogRejection; message: string }
> = {
	"invalid-name": {
		status: 422,
		error: "invalid-name",
		message: READLIST_NAME_LENGTH_MESSAGE,
	},
	"reserved-name": {
		status: 422,
		error: "reserved-name",
		message: "Pick a name other than All, the readlist that holds every save.",
	},
	"name-taken": {
		status: 422,
		error: "name-taken",
		message: "You already have a readlist with that name, so pick another one.",
	},
};

export const READLIST_RENAME_REJECTIONS: Record<
	ReadlistRenameRejection,
	{ status: number; error: ReadlistRenameRejection; message: string }
> = {
	"unknown-readlist": {
		status: 404,
		error: "unknown-readlist",
		message: "That readlist no longer exists.",
	},
	"invalid-name": {
		status: 422,
		error: "invalid-name",
		message: READLIST_NAME_LENGTH_MESSAGE,
	},
	"name-taken": {
		status: 422,
		error: "name-taken",
		message:
			"You already have a readlist with that name, and it's too long to number. Try a shorter one.",
	},
};

export const READLIST_PURPOSE_INVALID_MESSAGE = `Say what this readlist is for, in up to ${new Intl.NumberFormat("en-US").format(READLIST_PURPOSE_MAX_LENGTH)} characters.`;

export type ReadlistErrorFlashMapping = (query: Record<string, unknown>) => string | undefined;

export const readlistErrorFlashMapping: ReadlistErrorFlashMapping = (query) => {
	const errorCode = typeof query.queue_error === "string" ? query.queue_error : undefined;
	return errorCode ? READLIST_ERROR_MESSAGES[errorCode] : undefined;
};

export type HttpErrorMessageMapping = (query: Record<string, unknown>) => string | undefined;

export const httpErrorMessageMapping: HttpErrorMessageMapping = (query) => {
	const errorCode = typeof query.error_code === "string" ? query.error_code : undefined;
	return errorCode ? SAVE_ERROR_MESSAGES[errorCode] : undefined;
};

export function saveableUrlErrorCodeMapping(
	query: Record<string, unknown>,
): SaveableUrlErrorCode | undefined {
	const parsed = SaveableUrlErrorCodeSchema.safeParse(query.error_code);
	return parsed.success ? parsed.data : undefined;
}

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
 * readlist page can confirm the change with a toast and offer a working Undo
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
	const base = `${imported} of ${total} link${total === 1 ? "" : "s"} imported.`;
	if (Number.isFinite(skipped) && skipped > 0) {
		return `${base} ${skipped} couldn't be imported.`;
	}
	return base;
};
