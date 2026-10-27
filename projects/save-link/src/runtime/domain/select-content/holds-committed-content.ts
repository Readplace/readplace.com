import type { Article } from "@packages/domain/article-aggregate";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";

const EMPTY_TEXT_HASH = computeCanonicalContentHash("");

export function holdsCommittedContent(article: Article): boolean {
	const { canonicalContentHash } = article.freshness;
	return canonicalContentHash !== undefined && canonicalContentHash !== EMPTY_TEXT_HASH;
}
