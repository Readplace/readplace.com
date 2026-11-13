import type { ReadlistRef } from "./reader-readlists";
import { DEFAULT_READLIST_SLUG, READLIST_PINNED_MAX, type ReadlistSlug } from "./readlist-name.schema";

export type ReadlistPinRejection = "unknown-readlist" | "limit-reached";

export type ReadlistPinDecision =
	| { ok: true; slug: ReadlistSlug }
	| { ok: false; reason: ReadlistPinRejection };

export function pinnedReadlistSlugs(
	definitions: readonly { slug: ReadlistSlug; pinnedAt?: Date }[],
): readonly ReadlistSlug[] {
	return definitions
		.flatMap((definition) =>
			definition.pinnedAt === undefined ? [] : [{ slug: definition.slug, pinnedAt: definition.pinnedAt }],
		)
		.sort((a, b) => a.pinnedAt.getTime() - b.pinnedAt.getTime() || a.slug.localeCompare(b.slug))
		.map((definition) => definition.slug);
}

export function decideReadlistPin(input: {
	slug: ReadlistSlug;
	readlists: readonly ReadlistRef[];
	pinned: readonly ReadlistSlug[];
}): ReadlistPinDecision {
	if (input.slug === DEFAULT_READLIST_SLUG) return { ok: false, reason: "unknown-readlist" };
	if (!input.readlists.some((readlist) => readlist.slug === input.slug)) {
		return { ok: false, reason: "unknown-readlist" };
	}
	if (input.pinned.includes(input.slug)) return { ok: true, slug: input.slug };
	if (input.pinned.length >= READLIST_PINNED_MAX) return { ok: false, reason: "limit-reached" };
	return { ok: true, slug: input.slug };
}
