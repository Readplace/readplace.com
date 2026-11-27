import { isBuiltInReadlist } from "./built-in-readlists";
import assert from "node:assert";
import { READLIST_PINNED_MAX, type ReadlistSlug, type ReadlistRef } from "@packages/domain/readlist";

export const READLIST_NAV_FULL_LIST_MAX = 7;

export interface ReadlistNavLayout {
	mode: "today" | "pinned-rail";
	railEntries: readonly ReadlistRef[];
	moreEntries: readonly ReadlistRef[];
	moreCount: number;
}

export function composeReadlistNav(input: {
	readlists: readonly ReadlistRef[];
	pinned: readonly ReadlistSlug[];
	currentSlug: ReadlistSlug;
}): ReadlistNavLayout {
	const permanent = input.readlists.filter(list => isBuiltInReadlist(list.slug));
	const named = input.readlists.filter(list => !isBuiltInReadlist(list.slug));
	if (named.length <= READLIST_NAV_FULL_LIST_MAX) {
		return { mode: "today", railEntries: input.readlists, moreEntries: [], moreCount: 0 };
	}
	assert(permanent.length > 0, "the readlists start with the built-in readlist");
	const slots = [
		...input.pinned.flatMap((slug) => named.filter((readlist) => readlist.slug === slug)),
		...named.filter((readlist) => !input.pinned.includes(readlist.slug)),
	].slice(0, READLIST_PINNED_MAX);
	const current = named.filter(
		(readlist) => readlist.slug === input.currentSlug && !slots.includes(readlist),
	);
	const rail = [...current, ...slots];
	const moreEntries = named.filter((readlist) => !rail.includes(readlist));
	return {
		mode: "pinned-rail",
		railEntries: [...permanent, ...rail],
		moreEntries,
		moreCount: moreEntries.length,
	};
}
