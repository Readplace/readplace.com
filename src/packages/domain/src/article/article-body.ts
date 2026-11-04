import { z } from "zod";
import type { UserId } from "../user";
import { isNonArticleHost } from "./non-article-host";
import { mayReadItem, type Viewer } from "./private-item-access";

const ArticleBodySchema = z.string().brand<"ArticleBody">();
export type ArticleBody = z.infer<typeof ArticleBodySchema>;

export type StoredArticleBody =
	| { readonly kind: "article"; readonly body: ArticleBody }
	| { readonly kind: "missing" }
	| { readonly kind: "not-an-article" };

export function storedArticleBody(stored: {
	url: string;
	html: string | undefined;
	viewer: Viewer;
	ownerUserId: UserId | undefined;
}): StoredArticleBody {
	if (isNonArticleHost(stored.url)) return { kind: "not-an-article" };
	if (!mayReadItem(stored)) return { kind: "not-an-article" };
	if (!stored.html) return { kind: "missing" };
	return { kind: "article", body: ArticleBodySchema.parse(stored.html) };
}
