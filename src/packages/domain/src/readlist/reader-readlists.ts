import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "./readlist-name.schema";

export const DEFAULT_READLIST_LABEL = "All";

export interface ReadlistRef {
	slug: ReadlistSlug;
	label: string;
}

export const DEFAULT_READLIST: ReadlistRef = {
	slug: DEFAULT_READLIST_SLUG,
	label: DEFAULT_READLIST_LABEL,
};

export function readerReadlists(
	definitions: readonly ReadlistRef[],
): readonly ReadlistRef[] {
	return [DEFAULT_READLIST, ...definitions.map(({ slug, label }) => ({ slug, label }))];
}

export function readlistsHoldingArticle(input: {
	saves: readonly { readlist?: ReadlistSlug }[];
	readlists: readonly ReadlistRef[];
}): readonly ReadlistRef[] {
	const held = new Set(
		input.saves.map((save) => save.readlist ?? DEFAULT_READLIST_SLUG),
	);
	return input.readlists.filter((readlist) => held.has(readlist.slug));
}
