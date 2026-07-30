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
 * hypermedia-api-design skill, "Server-Driven Messages Are Trusted HTML". */
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

/** The outcome of invoking one advertised per-item action by (id, name). A
 * simple entity mutation lands the client back on the collection, so success
 * carries the new items; `not-found` covers an item or action the server no
 * longer advertises (the client re-renders the fresh list either way). */
export type InvokeActionResult =
	| { ok: true; items: ReadingListItem[] }
	| { ok: false; reason: "not-found" };

export type SaveUrl = (params: {
	url: string;
	title: string;
	content?: TabContent;
}) => Promise<SaveUrlResult>;

/** The outcome of a deferred content upload onto an article the link save
 * already created. `unsupported` and `rejected` are both the server's final
 * word on this payload — nothing is retried, and no URL-only fallback is
 * followed, because the link save has already happened and only the enrichment
 * is lost. Anything transient throws instead, so the caller can back off. */
export type UploadContentResult =
	| { ok: true }
	| { ok: false; reason: "unsupported" | "rejected" };

/** Uploads captured bytes against a URL that is already saved. The `url` must
 * be byte-identical to the one the link save used — it is the identity the
 * server reconciles the content onto. */
export type UploadContent = (params: {
	url: string;
	title?: string;
	content: TabContent;
}) => Promise<UploadContentResult>;

/** Invokes the named action the server advertised on the item with `id`. The
 * popup learned the `name` from the item's descriptor list and echoes it back;
 * the walker holds the bound callable and resolves (id, name) to it. Two
 * same-typed strings, so a named-parameter object guards against a swap. */
export type InvokeAction = (params: {
	id: ReadingListItemId;
	name: string;
}) => Promise<InvokeActionResult>;

export type FindByUrl = (
	url: string,
) => Promise<ReadingListItem | null>;

export type GetAllItems = () => Promise<ReadingListItem[]>;

export type BulkSaveResult = {
	saved: number;
	skipped: number;
	failed: number;
	/** Pages whose captured content was over the per-page cap: saved URL-only and
	 * reported here with their size (MB) so the popup can tell the user. */
	tooBig: { url: string; mb: number }[];
	skippedUrls: { url: string; code: string }[];
};

/** One page in a bulk "Save All Tabs" request. `content` carries the captured
 * bytes when the tab was scriptable; its absence means a URL-only save (an
 * unscriptable or discarded tab the background could not capture). */
export type BulkSavePage = {
	url: string;
	title?: string;
	content?: TabContent;
};

export type SavePages = (params: { pages: BulkSavePage[] }) => Promise<BulkSaveResult>;
