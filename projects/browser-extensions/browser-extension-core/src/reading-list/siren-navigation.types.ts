import type { z } from "zod";
import type { ReadingListItem } from "../domain/reading-list-item.types";
import type { CollectionTotal, Message } from "./reading-list.types";
import type {
	SirenCollectionResponse,
	SirenAction,
	PageEntry,
	SortEntry,
	SaveArticlesResultSchema,
} from "./siren-wire";

export type DoFetchInit = Omit<RequestInit, "headers"> & {
	headers?: Record<string, string>;
};

export type DoFetch = (url: string, init?: DoFetchInit) => Promise<Response>;

export type ActionContext = {
	serverUrl: string;
	doFetch: DoFetch;
	resolveItem: (entity: unknown) => ArticleItem;
	parseCollection: (body: SirenCollectionResponse) => Promise<NavigationResult>;
};

export type ActionHandler = (
	sirenAction: SirenAction,
	context: ActionContext,
) => BoundAction;

export type BoundAction = (
	fields?: Record<string, string>,
) => Promise<NavigationResult>;

export type NavigationResult = {
	items: ArticleItem[];
	actions: Record<string, BoundAction>;
	descriptors: Record<string, SirenAction>;
	pages: PageEntry[];
	total: CollectionTotal | undefined;
	sorts: SortEntry[];
	followPage: (href: string) => Promise<NavigationResult>;
	/** Set only by the save-articles understanding; carries the bulk-save
	 * summary so `savePages` can surface it. Other actions leave it undefined. */
	bulk?: z.infer<typeof SaveArticlesResultSchema>["properties"];
	/** What the server asked the client to tell the reader about this response;
	 * empty when it asked for nothing. */
	messages: Message[];
};

/** The walker's in-memory item. It keeps the cross-boundary `ReadingListItem`
 * intact — including its serializable `actions` descriptors, which DO survive
 * the popup sendMessage boundary — and adds `boundActions`: the bound callables
 * the walker invokes, keyed by action name. The callables can't be cloned across
 * the boundary, so they live only here; the popup re-invokes by (id, name) and
 * the walker resolves the name back to its `boundActions` entry. */
export type ArticleItem = ReadingListItem & {
	boundActions: Record<string, BoundAction>;
};
