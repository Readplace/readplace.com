import type { z } from "zod";
import type { UserId } from "../user/user.types";
import type { MinutesSchema } from "./article.schema";
import type { ReaderArticleHashId } from "./reader-article-hash-id";

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
	url: string;
	metadata: ArticleMetadata;
	content?: string;
	estimatedReadTime: Minutes;
	status: ArticleStatus;
	savedAt: Date;
	readAt?: Date;
}
