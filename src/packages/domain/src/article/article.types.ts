import type { UserId } from "../user/user.types";
import type { ReaderArticleHashId } from "./reader-article-hash-id";

export type Minutes = number & { readonly __brand: "Minutes" };

export type ArticleStatus = "unread" | "read" | "deleted";

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
