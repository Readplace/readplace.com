import { createHash } from "node:crypto";
import type { SavedArticle } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { computeArticleContentVersion } from "../../../shared/article-content-version";
import type { ReaderProvenance } from "../../../shared/article-body/article-header/provenance-label";
import { readlistCardVia } from "./readlist-card-via";

export interface ReadlistCardEtagInput {
	article: SavedArticle;
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
	readerProvenance: ReaderProvenance | undefined;
}

function viaSegmentOf(readerProvenance: ReaderProvenance | undefined): string[] {
	const via = readlistCardVia(readerProvenance);
	if (via === undefined) return [];
	const hash = createHash("sha256");
	hash.update(via.label);
	hash.update("|");
	hash.update(via.sender?.address ?? "");
	return [hash.digest("hex").slice(0, 16)];
}

export function computeReadlistCardEtag(input: ReadlistCardEtagInput): string {
	const { article, crawl, summary, readerProvenance } = input;
	const contentVersion = computeArticleContentVersion({ article, crawl, summary });
	return `W/"${[article.id.value, article.status, contentVersion, ...viaSegmentOf(readerProvenance)].join(":")}"`;
}
