import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "./readlist-name.schema";
import { parseReadlistPurpose } from "./readlist-purpose.schema";

export type ReadlistPurposeRejection = "unknown-readlist" | "invalid-purpose";

export type ReadlistPurposeDecision =
	| { ok: true; slug: ReadlistSlug; purpose: string }
	| { ok: false; reason: ReadlistPurposeRejection };

export type ReadlistPurposeClearDecision =
	| { ok: true; slug: ReadlistSlug }
	| { ok: false; reason: "unknown-readlist" };

function ownsCustomReadlist(params: {
	slug: ReadlistSlug;
	readlists: readonly { slug: ReadlistSlug }[];
}): boolean {
	if (params.slug === DEFAULT_READLIST_SLUG) return false;
	return params.readlists.some((readlist) => readlist.slug === params.slug);
}

export function decideReadlistPurpose(params: {
	slug: ReadlistSlug;
	purpose: string;
	readlists: readonly { slug: ReadlistSlug }[];
}): ReadlistPurposeDecision {
	if (!ownsCustomReadlist(params)) return { ok: false, reason: "unknown-readlist" };
	const purpose = parseReadlistPurpose(params.purpose);
	if (!purpose) return { ok: false, reason: "invalid-purpose" };
	return { ok: true, slug: params.slug, purpose };
}

export function decideReadlistPurposeClear(params: {
	slug: ReadlistSlug;
	readlists: readonly { slug: ReadlistSlug }[];
}): ReadlistPurposeClearDecision {
	if (!ownsCustomReadlist(params)) return { ok: false, reason: "unknown-readlist" };
	return { ok: true, slug: params.slug };
}
