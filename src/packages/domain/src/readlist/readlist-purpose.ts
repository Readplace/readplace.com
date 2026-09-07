import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "./readlist-name.schema";
import { parseReadlistPurpose } from "./readlist-purpose.schema";

export type ReadlistPurposeRejection = "unknown-readlist" | "invalid-purpose";

export type ReadlistPurposeDecision =
	| { ok: true; slug: ReadlistSlug; purpose: string }
	| { ok: false; reason: ReadlistPurposeRejection };

export function decideReadlistPurpose(params: {
	slug: ReadlistSlug;
	purpose: string;
	readlists: readonly { slug: ReadlistSlug }[];
}): ReadlistPurposeDecision {
	if (params.slug === DEFAULT_READLIST_SLUG) return { ok: false, reason: "unknown-readlist" };
	if (!params.readlists.some((readlist) => readlist.slug === params.slug)) {
		return { ok: false, reason: "unknown-readlist" };
	}
	const purpose = parseReadlistPurpose(params.purpose);
	if (!purpose) return { ok: false, reason: "invalid-purpose" };
	return { ok: true, slug: params.slug, purpose };
}
