import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "./readlist-name.schema";

export type ReadlistMigrationRejection = "unknown-readlist" | "same-readlist";

export type ReadlistMigrationDecision =
	| { ok: true; from: ReadlistSlug; to: ReadlistSlug }
	| { ok: false; reason: ReadlistMigrationRejection };

export function decideReadlistMigration(params: {
	from: ReadlistSlug;
	to: ReadlistSlug;
	readlists: readonly { slug: ReadlistSlug; label: string }[];
}): ReadlistMigrationDecision {
	if (params.from === DEFAULT_READLIST_SLUG) return { ok: false, reason: "unknown-readlist" };
	if (params.to === DEFAULT_READLIST_SLUG) return { ok: false, reason: "unknown-readlist" };
	if (params.from === params.to) return { ok: false, reason: "same-readlist" };
	const owns = (slug: ReadlistSlug) => params.readlists.some((readlist) => readlist.slug === slug);
	if (!owns(params.from) || !owns(params.to)) return { ok: false, reason: "unknown-readlist" };
	return { ok: true, from: params.from, to: params.to };
}
