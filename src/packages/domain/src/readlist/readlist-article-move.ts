import { type ReadlistRef, readlistsHoldingArticle } from "./reader-readlists";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "./readlist-name.schema";

export type ReadlistArticleMoveRejection =
	| "same-readlist"
	| "unknown-readlist"
	| "not-in-source"
	| "already-in-destination";

export type ReadlistArticleMoveDecision =
	| {
			ok: true;
			from: ReadlistSlug;
			to: ReadlistSlug;
			copyInto?: ReadlistSlug;
			removeFrom?: ReadlistSlug;
		}
	| { ok: false; reason: ReadlistArticleMoveRejection };

export function decideReadlistArticleMove(params: {
	from: ReadlistSlug;
	to: ReadlistSlug;
	readlists: readonly ReadlistRef[];
	saves: readonly { readlist?: ReadlistSlug }[];
}): ReadlistArticleMoveDecision {
	if (params.from === params.to) return { ok: false, reason: "same-readlist" };
	const owns = (slug: ReadlistSlug) => params.readlists.some((readlist) => readlist.slug === slug);
	if (!owns(params.from) || !owns(params.to)) return { ok: false, reason: "unknown-readlist" };
	const holders = new Set(
		readlistsHoldingArticle({ saves: params.saves, readlists: params.readlists }).map(
			(readlist) => readlist.slug,
		),
	);
	if (!holders.has(params.from)) return { ok: false, reason: "not-in-source" };
	const destinationHolds = holders.has(params.to);
	if (destinationHolds && params.to !== DEFAULT_READLIST_SLUG) {
		return { ok: false, reason: "already-in-destination" };
	}
	return {
		ok: true,
		from: params.from,
		to: params.to,
		...(destinationHolds ? {} : { copyInto: params.to }),
		...(params.from === DEFAULT_READLIST_SLUG ? {} : { removeFrom: params.from }),
	};
}
