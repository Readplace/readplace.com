import assert from "node:assert";
import { type ArticleBody, storedArticleBody } from "@packages/domain/article";

export function articleBody(html: string): ArticleBody {
	const stored = storedArticleBody({ url: "https://example.com/article", html });
	assert(stored.kind === "article", "an article body must be non-empty HTML");
	return stored.body;
}
