import type { Highlight } from "@packages/domain/article";
import type { ReadCanonicalSnapshot } from "@packages/provider-contracts/canonical-snapshot";
import type { Request } from "express";
import type { CanSaveContent } from "../../middleware/can-save-content";
import { isNativeSurface, nativeSurfaceQuery } from "../../onboarding/native-client";
import type { HighlightFormScope } from "../../shared/article-body/highlights/highlight-note-dialog.component";
import { requestedReaderSection } from "../../shared/article-body/reader-slot/section-pages";
import { type LinkParams, parseReadlistUrl, readlistReturnQuery } from "./readlist.url";

export interface ReaderHighlightOptions {
	rows: readonly Highlight[];
	canonicalContentHash: string | undefined;
	scope: HighlightFormScope | undefined;
}

export type ReaderHighlightOptionsFor = (
	req: Request,
	input: { article: { id: { value: string }; url: string }; rows: readonly Highlight[] },
) => Promise<ReaderHighlightOptions>;

export function highlightFormScopeFor(req: Request, articleId: string): HighlightFormScope {
	const section = requestedReaderSection(req.query.section);
	const readlist: LinkParams = [
		...new URLSearchParams(readlistReturnQuery(parseReadlistUrl(req.query)).slice(1)),
		...(section === undefined ? [] : [["section", String(section)] as const]),
	];
	return {
		articleId,
		readlist,
		surface: [...new URLSearchParams(nativeSurfaceQuery(req))],
	};
}

export function initReaderHighlightOptions(deps: {
	canSaveContent: CanSaveContent;
	readCanonicalSnapshot: ReadCanonicalSnapshot;
}): ReaderHighlightOptionsFor {
	return async (req, { article, rows }) => {
		const writable = !isNativeSurface(req) || (await deps.canSaveContent(req));
		return {
			rows,
			canonicalContentHash: (await deps.readCanonicalSnapshot(article.url))?.canonicalContentHash,
			scope: writable ? highlightFormScopeFor(req, article.id.value) : undefined,
		};
	};
}
