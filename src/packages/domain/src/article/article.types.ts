import type { z } from "zod";
import type { UserId } from "../user/user.types";
import type { ArticleDestinationUrl, SiteLabel } from "./article-site";
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

type DisplayMetadata = Omit<ArticleMetadata, "siteName"> & { siteName: SiteLabel };

export interface SavedArticle {
	id: ReaderArticleHashId;
	userId: UserId;
	/** Identity: the URL every lookup keys on (crawl status, content, freshness).
	 * Never swap this for the destination — `resolveReaderState` reads it. */
	url: string;
	destinationUrl: ArticleDestinationUrl;
	metadata: DisplayMetadata;
	content?: string;
	estimatedReadTime: Minutes;
	status: ArticleStatus;
	savedAt: Date;
	readAt?: Date;
	contentFetchedAt?: Date;
	/** Where this save came from. Absent on rows saved before provenance was
	 * captured; a re-save stamps one. */
	provenance?: SaveProvenance;
	relatedDismissedAt?: Date;
	relatedDismissedSuggestionId?: ReaderArticleHashId;
}
