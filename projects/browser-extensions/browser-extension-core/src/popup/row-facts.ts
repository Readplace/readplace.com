import type { IconName } from "@packages/ui-icons";
import type { ReadingListItem } from "../domain/reading-list-item.types";
import { itemDisplay } from "./item-display";
import { relativeTime } from "./relative-time";

export type RowFactKind = "site" | "saved";

export interface RowFact {
	readonly kind: RowFactKind;
	readonly text: string;
	readonly iconName: IconName;
}

export function rowFacts(item: Pick<ReadingListItem, "url" | "savedAt">): RowFact[] {
	const { hostname } = itemDisplay(item);
	const site: RowFact[] = hostname ? [{ kind: "site", text: hostname, iconName: "globe" }] : [];
	return [...site, { kind: "saved", text: relativeTime(new Date(item.savedAt)), iconName: "clock" }];
}
