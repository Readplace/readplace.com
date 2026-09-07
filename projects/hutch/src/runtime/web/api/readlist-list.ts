import type { ReadlistSlug } from "@packages/domain/readlist";

export type ReadlistRel = "current" | "readlist";

export interface ReadlistOption {
	readonly slug: ReadlistSlug;
	readonly label: string;
}

export interface ReadlistListEntry {
	readonly label: string;
	readonly rel: ReadlistRel;
	readonly href: string;
}

export function buildReadlistList(input: {
	readlists: readonly ReadlistOption[];
	currentReadlist: ReadlistSlug;
	hrefForReadlist: (readlist: ReadlistSlug) => string;
}): ReadlistListEntry[] {
	return input.readlists.map((readlist) => ({
		label: readlist.label,
		rel: readlist.slug === input.currentReadlist ? "current" : "readlist",
		href: input.hrefForReadlist(readlist.slug),
	}));
}
