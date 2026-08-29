import { nextAvailableReadlistLabel } from "./next-available-readlist-label";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug, parseReadlistLabel } from "./readlist-name.schema";

export type ReadlistRenameRejection = "unknown-readlist" | "invalid-name" | "name-taken";

export type ReadlistRenameDecision =
	| { ok: true; slug: ReadlistSlug; label: string }
	| { ok: false; reason: ReadlistRenameRejection };

export function decideReadlistRename(params: {
	slug: ReadlistSlug;
	label: string;
	readlists: readonly { slug: ReadlistSlug; label: string }[];
}): ReadlistRenameDecision {
	if (params.slug === DEFAULT_READLIST_SLUG) return { ok: false, reason: "unknown-readlist" };
	if (!params.readlists.some((readlist) => readlist.slug === params.slug)) {
		return { ok: false, reason: "unknown-readlist" };
	}
	const typed = parseReadlistLabel(params.label);
	if (!typed) return { ok: false, reason: "invalid-name" };
	const numbered = nextAvailableReadlistLabel({
		label: typed,
		takenLabels: params.readlists
			.filter((readlist) => readlist.slug !== params.slug)
			.map((readlist) => readlist.label),
	});
	const label = parseReadlistLabel(numbered);
	if (!label) return { ok: false, reason: "name-taken" };
	return { ok: true, slug: params.slug, label };
}
