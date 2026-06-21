export type { ReadingListItemId } from "./reading-list-item-id";
import type { ReadingListItemId } from "./reading-list-item-id";

export interface ReadingListItem {
	id: ReadingListItemId;
	url: string;
	title: string;
	savedAt: Date;
	readUrl?: string;
}
