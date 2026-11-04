import assert from "node:assert";
import { ANONYMOUS_VIEWER, type ArticleBody, storedArticleBody } from "@packages/domain/article";

export function articleBody(html: string): ArticleBody {
	const stored = storedArticleBody({ url: "https://example.com/article", html, viewer: ANONYMOUS_VIEWER, ownerUserId: undefined });
	assert(stored.kind === "article", "an article body must be non-empty HTML");
	return stored.body;
}
