import type { ReadlistRef } from "./reader-readlists";
import { READLIST_PINNED_MAX, type ReadlistSlug } from "./readlist-name.schema";
import { ownsCustomReadlist } from "./readlist-owned";

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
	if (!ownsCustomReadlist(input)) return { ok: false, reason: "unknown-readlist" };
	if (input.pinned.includes(input.slug)) return { ok: true, slug: input.slug };
	if (input.pinned.length >= READLIST_PINNED_MAX) return { ok: false, reason: "limit-reached" };
	return { ok: true, slug: input.slug };
}
