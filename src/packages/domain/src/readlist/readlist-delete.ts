import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "./readlist-name.schema";

export type ReadlistDeleteRejection = "unknown-readlist";

export type ReadlistDeleteDecision =
	| { ok: true; slug: ReadlistSlug }
	| { ok: false; reason: ReadlistDeleteRejection };

export function decideReadlistDelete(params: {
	slug: ReadlistSlug;
	readlists: readonly { slug: ReadlistSlug; label: string }[];
}): ReadlistDeleteDecision {
	if (params.slug === DEFAULT_READLIST_SLUG) return { ok: false, reason: "unknown-readlist" };
	if (!params.readlists.some((readlist) => readlist.slug === params.slug)) {
		return { ok: false, reason: "unknown-readlist" };
	}
	return { ok: true, slug: params.slug };
}

export function readlistAfterDelete(input: { viewed: ReadlistSlug; deleted: ReadlistSlug }): ReadlistSlug {
	return input.viewed === input.deleted ? DEFAULT_READLIST_SLUG : input.viewed;
}
