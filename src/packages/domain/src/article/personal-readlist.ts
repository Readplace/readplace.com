import type { UserId } from "../user";
import type { ArticleStatus } from "./article.types";
import type { SaveAttemptId } from "./article.schema";
import type { ReaderArticleHashId } from "./reader-article-hash-id";

export type PersonalReadlist = "picked" | "uncertain";

export interface PersonalPickRequest {
	requestedAt: string;
	attemptId: SaveAttemptId;
}

export function personalDecisionKey(request: PersonalPickRequest): string {
	return `${new Date(request.requestedAt).toISOString()}#${request.attemptId}`;
}

export function personalReadlistPartition(userId: UserId, scope: PersonalReadlist, status: ArticleStatus): string {
	return `${userId}#${scope}#${status}`;
}

export function personalReadlistOrder(instant: string, articleId: ReaderArticleHashId): string {
	return `${new Date(instant).toISOString()}#${articleId.value}`;
}
