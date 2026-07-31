import type { ReadingListItemId } from "./domain/reading-list-item.types";
import type { SaveableTab } from "./popup/save-all-tabs";

export type PopupMessage =
	| { type: "save-current-tab"; url: string; title: string; tabId?: number }
	| { type: "invoke-action"; id: ReadingListItemId; name: string }
	| { type: "save-all-tabs"; tabs: SaveableTab[] }
	| { type: "get-all-items" }
	| { type: "get-more-items" }
	| { type: "login" }
	| { type: "logout" };
