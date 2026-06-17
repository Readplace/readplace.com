import type { ReadingListItemId } from "./domain/reading-list-item.types";
import type { SavePhase } from "./popup/save-progress";

export type PopupMessage =
	| { type: "save-current-tab"; url: string; title: string; rawHtml?: string; tabId?: number }
	| { type: "save-progress"; phase: SavePhase }
	| { type: "invoke-action"; id: ReadingListItemId; name: string }
	| { type: "check-url"; url: string }
	| { type: "save-all-tabs"; urls: string[] }
	| { type: "get-all-items" }
	| { type: "login" }
	| { type: "logout" };
