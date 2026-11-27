import type { ReadlistSlug } from "./readlist-name.schema";
import { ownsCustomReadlist } from "./readlist-owned";
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
	if (!ownsCustomReadlist(params)) return { ok: false, reason: "unknown-readlist" };
	const purpose = parseReadlistPurpose(params.purpose);
	if (!purpose) return { ok: false, reason: "invalid-purpose" };
	return { ok: true, slug: params.slug, purpose };
}
