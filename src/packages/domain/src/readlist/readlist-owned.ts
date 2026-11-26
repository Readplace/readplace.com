import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "./readlist-name.schema";

export function ownsCustomReadlist(params: {
	slug: ReadlistSlug;
	readlists: readonly { slug: ReadlistSlug }[];
}): boolean {
	if (params.slug === DEFAULT_READLIST_SLUG) return false;
	return params.readlists.some((readlist) => readlist.slug === params.slug);
}

export function decideOwnedCustomReadlist(params: {
	slug: ReadlistSlug;
	readlists: readonly { slug: ReadlistSlug }[];
}): { ok: true; slug: ReadlistSlug } | { ok: false; reason: "unknown-readlist" } {
	if (!ownsCustomReadlist(params)) return { ok: false, reason: "unknown-readlist" };
	return { ok: true, slug: params.slug };
}
