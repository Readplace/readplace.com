import type { ReadingListItem } from "../domain/reading-list-item.types";

export interface ItemDisplay {
	hostname: string;
}

/** Derives the row's display fields from an item whose `url` may be empty or
 * malformed (the core keeps a degraded entity renderable rather than blanking
 * the list). The hostname falls back to "" so a bad url yields a blank-domain
 * row instead of throwing mid-render. Navigation is not derived here: the row
 * anchor is repointed to the server's looped `read` link, the single
 * unambiguous anchor source, so this never re-derives an href from a domain
 * property. */
export function itemDisplay(item: Pick<ReadingListItem, "url">): ItemDisplay {
	return {
		hostname: safeHostname(item.url),
	};
}

function safeHostname(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return "";
	}
}
