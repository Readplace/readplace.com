import { DEFAULT_READLIST_SLUG, type ReadlistSlug, parseReadlistLabel } from "./readlist-name.schema";

export type ReadlistCreateRejection = "invalid-name" | "reserved-name";

export type ReadlistCreateDecision =
	| { ok: true; slug: ReadlistSlug; create: { label: string } | undefined }
	| { ok: false; reason: ReadlistCreateRejection };

export function decideReadlistCreate(params: {
	label: string;
	slug: ReadlistSlug;
	readlists: readonly { slug: ReadlistSlug; label: string }[];
}): ReadlistCreateDecision {
	const typed = parseReadlistLabel(params.label);
	if (!typed) return { ok: false, reason: "invalid-name" };
	const match = params.readlists.find(
		(readlist) => readlist.label.toLowerCase() === typed.toLowerCase(),
	);
	if (match) {
		if (match.slug === DEFAULT_READLIST_SLUG) return { ok: false, reason: "reserved-name" };
		return { ok: true, slug: match.slug, create: undefined };
	}
	return { ok: true, slug: params.slug, create: { label: typed } };
}
