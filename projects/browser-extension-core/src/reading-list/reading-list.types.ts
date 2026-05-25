import type {
	ReadingListItem,
	ReadingListItemId,
} from "../domain/reading-list-item.types";

export interface SaveWarning {
	readonly code: string;
	readonly message: string;
}

export type SaveUrlResult =
	| { ok: true; item: ReadingListItem }
	| { ok: false; reason: "already-saved" }
	| {
			ok: false;
			reason: "not-saveable";
			items: ReadingListItem[];
			warning?: SaveWarning;
	  };

export type RemoveUrlResult =
	| { ok: true; items: ReadingListItem[] }
	| { ok: false; reason: "not-found" };

export type SaveUrl = (params: {
	url: string;
	title: string;
	rawHtml?: string;
	/** Raw PDF bytes captured from the user's browser context. When present
	 * (and the server advertises the `save-pdf` action), routes through the
	 * tier-0 PDF upload path so the server skips the bot-defended fetch. Any
	 * failure falls back to the URL-only `save-article` path. */
	pdfBytes?: ArrayBuffer;
}) => Promise<SaveUrlResult>;

export type RemoveUrl = (
	id: ReadingListItemId,
) => Promise<RemoveUrlResult>;

export type FindByUrl = (
	url: string,
) => Promise<ReadingListItem | null>;

export type GetAllItems = () => Promise<ReadingListItem[]>;
