import type { ReadlistSlug } from "@packages/domain/readlist";
import { buildQueryString } from "./collection-query";
import type { ReadlistOption } from "./readlist-list";

export function readlistHref(readlist: ReadlistSlug): string {
	return `/queue${buildQueryString({ readlist })}`;
}

export function readlistsAtHrefs(input: {
	hrefs: readonly string[];
	readlists: readonly ReadlistOption[];
}): readonly ReadlistOption[] {
	const byHref = new Map(input.readlists.map((readlist) => [readlistHref(readlist.slug), readlist]));
	const resolved = new Map<ReadlistSlug, ReadlistOption>();
	for (const href of input.hrefs) {
		const readlist = byHref.get(href);
		if (readlist) resolved.set(readlist.slug, readlist);
	}
	return [...resolved.values()];
}
