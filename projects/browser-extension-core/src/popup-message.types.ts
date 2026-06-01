import type { ReadingListItemId } from "./domain/reading-list-item.types";
import type { SavePhase } from "./popup/save-progress";

export type PopupMessage =
	| { type: "save-current-tab"; url: string; title: string; rawHtml?: string }
	| { type: "save-progress"; phase: SavePhase }
	| { type: "remove-item"; id: ReadingListItemId }
	| { type: "check-url"; url: string }
	| { type: "get-all-items" }
	| { type: "login" }
	| { type: "logout" };
