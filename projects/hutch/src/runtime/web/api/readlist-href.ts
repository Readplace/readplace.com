import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import { READLIST_PATH } from "../pages/readlist/readlist.url";
import { buildQueryString } from "./collection-query";
import type { ReadlistOption } from "./readlist-list";

const HREF_BASE = "https://readlist.invalid";

export function readlistHref(readlist: ReadlistSlug): string {
	return `/queue${buildQueryString({ readlist })}`;
}

function slugAtHref(href: string): ReadlistSlug | undefined {
	const url = URL.parse(href, HREF_BASE);
	if (url?.pathname !== READLIST_PATH) return undefined;
	const slug = ReadlistSlugSchema.safeParse(
		url.searchParams.get("readlist") ?? url.searchParams.get("queue") ?? DEFAULT_READLIST_SLUG,
	);
	return slug.success ? slug.data : undefined;
}

export function readlistsAtHrefs(input: {
	hrefs: readonly string[];
	readlists: readonly ReadlistOption[];
}): readonly ReadlistOption[] {
	const bySlug = new Map(input.readlists.map((readlist) => [readlist.slug, readlist]));
	const resolved = new Map<ReadlistSlug, ReadlistOption>();
	for (const href of input.hrefs) {
		const slug = slugAtHref(href);
		const readlist = slug === undefined ? undefined : bySlug.get(slug);
		if (readlist) resolved.set(readlist.slug, readlist);
	}
	return [...resolved.values()];
}
