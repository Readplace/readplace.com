import type { z } from "zod";
import type { UserId } from "../user/user.types";
import type { MinutesSchema } from "./article.schema";
import type { ReaderArticleHashId } from "./reader-article-hash-id";
import type { SaveProvenance } from "./save-provenance";

export type Minutes = z.infer<typeof MinutesSchema>;

export type ArticleStatus = "unread" | "read";

export interface ArticleMetadata {
	title: string;
	siteName: string;
	excerpt: string;
	wordCount: number;
	imageUrl?: string;
}

export interface SavedArticle {
	id: ReaderArticleHashId;
	userId: UserId;
	/** Identity: the URL every lookup keys on (crawl status, content, freshness).
	 * Never swap this for the destination — `resolveReaderState` reads it. */
	url: string;
	/** The redirect destination this article was adopted onto, when it was reached
	 * by following a redirect from `url`. Purely for display ("View original", the
	 * Siren/API `url`, the queue card link); absent on a normal, non-adopted save. */
	displayUrl?: string;
	metadata: ArticleMetadata;
	content?: string;
	estimatedReadTime: Minutes;
	status: ArticleStatus;
	savedAt: Date;
	readAt?: Date;
	/** Where this save came from. Absent on rows saved before provenance was
	 * captured; a re-save stamps one. */
	provenance?: SaveProvenance;
	relatedDismissedAt?: Date;
}
