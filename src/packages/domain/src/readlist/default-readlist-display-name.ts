import { nextAvailableReadlistLabel } from "./next-available-readlist-label";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "./readlist-name.schema";

export interface DefaultReadlistNames {
	name: string;
	qualifiedName: string;
}

export function readlistLabelDisplayKey(label: string): string {
	return label
		.normalize("NFKC")
		.replace(/\p{Default_Ignorable_Code_Point}/gu, "")
		.replace(/\s+/gu, " ")
		.trim()
		.toLowerCase();
}

export function defaultReadlistDisplayName(params: {
	names: DefaultReadlistNames;
	namedLabels: readonly string[];
}): string {
	const taken = params.namedLabels.map(readlistLabelDisplayKey);
	if (!taken.includes(readlistLabelDisplayKey(params.names.name))) return params.names.name;
	return nextAvailableReadlistLabel({
		label: params.names.qualifiedName.normalize("NFKC").replace(/\s+/gu, " ").trim(),
		takenLabels: taken,
	});
}

export function presentReadlists<T extends { slug: ReadlistSlug; label: string }>(params: {
	readlists: readonly T[];
	defaultName: string;
}): T[] {
	return params.readlists.map((readlist) =>
		readlist.slug === DEFAULT_READLIST_SLUG ? { ...readlist, label: params.defaultName } : readlist,
	);
}

export function presentReaderReadlistLabels<T extends { slug: ReadlistSlug; label: string }>(params: {
	readlists: readonly T[];
	names: DefaultReadlistNames;
}): T[] {
	const defaultName = defaultReadlistDisplayName({
		names: params.names,
		namedLabels: params.readlists
			.filter((readlist) => readlist.slug !== DEFAULT_READLIST_SLUG)
			.map((readlist) => readlist.label),
	});
	return presentReadlists({ readlists: params.readlists, defaultName });
}
