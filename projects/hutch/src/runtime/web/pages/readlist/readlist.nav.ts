import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";

export interface Readlist {
	slug: ReadlistSlug;
	label: string;
}

export const DEFAULT_READLIST: Readlist = { slug: DEFAULT_READLIST_SLUG, label: "All" };
