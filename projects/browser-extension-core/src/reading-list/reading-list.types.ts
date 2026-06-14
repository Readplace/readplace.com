import type {
	ReadingListItem,
	ReadingListItemId,
} from "../domain/reading-list-item.types";

export interface SaveWarning {
	readonly code: string;
	readonly message: string;
}

/** A server-authored message the client renders generically — it carries no
 * feature-specific knowledge. `type` selects presentation; `content` is an HTML
 * fragment the client injects into a generic message view. The same shape is
 * used for every message the server asks the client to surface.
 *
 * Contract invariant: `content.body` MUST be trusted, server-authored,
 * server-side-escaped HTML. The client injects it as HTML (`innerHTML`), so a
 * body that interpolates any untrusted/user-derived value (a saved URL, a title,
 * an email) without escaping it server-side is markup injection. See the
 * extension-api-design skill, "Server-Driven Messages Are Trusted HTML". */
export interface Message {
	readonly type: "warning" | "error";
	readonly content: { readonly type: "text/html"; readonly body: string };
}

export type TabContent = { bytes: ArrayBuffer; mediaType: string };

export type SaveUrlResult =
	| { ok: true; item: ReadingListItem }
	| { ok: false; reason: "already-saved" }
	| {
			ok: false;
			reason: "not-saveable";
			items: ReadingListItem[];
			warning?: SaveWarning;
	  }
	| { ok: false; messages: Message[] };

export type RemoveUrlResult =
	| { ok: true; items: ReadingListItem[] }
	| { ok: false; reason: "not-found" };

export type SaveUrl = (params: {
	url: string;
	title: string;
	content?: TabContent;
}) => Promise<SaveUrlResult>;

export type RemoveUrl = (
	id: ReadingListItemId,
) => Promise<RemoveUrlResult>;

export type FindByUrl = (
	url: string,
) => Promise<ReadingListItem | null>;

export type GetAllItems = () => Promise<ReadingListItem[]>;
