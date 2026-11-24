import type { ReadlistSlug } from "@packages/domain/readlist";

export type ReadlistRel = "current" | "readlist";

export interface ReadlistOption {
	readonly slug: ReadlistSlug;
	readonly label: string;
}

export interface ReadlistDestination {
	readonly label: string;
	readonly href: string;
}

export type CurrentReadlistDestination =
	| { readonly preferences: ReadlistDestination }
	| { readonly integrations: ReadlistDestination };

export interface ReadlistListEntry {
	readonly label: string;
	readonly rel: ReadlistRel;
	readonly href: string;
	readonly pinned: boolean;
	readonly preferences?: ReadlistDestination;
	readonly integrations?: ReadlistDestination;
}

export function buildReadlistList(input: {
	readlists: readonly ReadlistOption[];
	currentReadlist: ReadlistSlug;
	pinnedReadlists: readonly ReadlistSlug[];
	hrefForReadlist: (readlist: ReadlistSlug) => string;
	destinationForCurrent?: (readlist: ReadlistSlug) => CurrentReadlistDestination;
}): ReadlistListEntry[] {
	return input.readlists.map((readlist) => {
		const entry: ReadlistListEntry = {
			label: readlist.label,
			rel: readlist.slug === input.currentReadlist ? "current" : "readlist",
			href: input.hrefForReadlist(readlist.slug),
			pinned: input.pinnedReadlists.includes(readlist.slug),
		};
		if (entry.rel !== "current" || !input.destinationForCurrent) return entry;
		return { ...entry, ...input.destinationForCurrent(readlist.slug) };
	});
}
