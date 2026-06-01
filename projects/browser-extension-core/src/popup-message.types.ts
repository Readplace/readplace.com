import type { ReadingListItemId } from "./domain/reading-list-item.types";

export type PopupMessage =
	| { type: "save-current-tab"; url: string; title: string; rawHtml?: string; tabId?: number }
	| { type: "remove-item"; id: ReadingListItemId }
	| { type: "check-url"; url: string }
	| { type: "get-all-items" }
	| { type: "login" }
	| { type: "logout" };
