import type {
	ReadingListItem,
	ReadingListItemId,
} from "../domain/reading-list-item.types";

export interface SaveWarning {
	readonly code: string;
	readonly message: string;
}

/** A server-authored message the client renders generically — it carries no
 * feature-specific knowledge. `type` selects presentation; `content.body` is the
 * payload and `content.type` its media type. The same shape is used for every
 * message the server asks the client to surface.
 *
 * The client renders only media types it understands. Today that is `text/html`,
 * which it injects as HTML (`innerHTML`); a message whose `content.type` is
 * anything else is ignored — never displayed, never injected — so the server can
 * adopt a richer media type without older clients mis-rendering an unknown body
 * as HTML. `content.type` is therefore `string`, not a literal: the envelope is
 * accepted liberally and the render layer decides what it can show.
 *
 * Contract invariant: a `text/html` `content.body` MUST be trusted, server-
 * authored, server-side-escaped HTML. The client injects it as HTML, so a body
 * that interpolates any untrusted/user-derived value (a saved URL, a title, an
 * email) without escaping it server-side is markup injection. See the
 * extension-api-design skill, "Server-Driven Messages Are Trusted HTML". */
export interface Message {
	readonly type: "warning" | "error";
	readonly content: { readonly type: string; readonly body: string };
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
