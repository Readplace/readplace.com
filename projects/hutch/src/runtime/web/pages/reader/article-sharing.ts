import { isPrivateItemUrl } from "@packages/domain/article";
import { parseEmailIssueArticleUrl } from "@packages/domain/inbox";
import { viewPathFor } from "../view/view-path";
import type { SharingOffReason } from "./sharing-off-dialog.component";

export type ArticleSharing =
	| { kind: "quote-only"; reason: SharingOffReason }
	| { kind: "view"; url: string }
	| { kind: "original"; url: string };

export function articleSharingFor(input: {
	articleUrl: string;
	originalUrl: string;
	appOrigin: string;
	readerViewShareable: boolean;
}): ArticleSharing {
	if (parseEmailIssueArticleUrl(input.articleUrl) !== undefined) return { kind: "quote-only", reason: "email-issue" };
	if (isPrivateItemUrl(input.articleUrl)) return { kind: "quote-only", reason: "private-upload" };
	if (input.readerViewShareable) return { kind: "view", url: `${input.appOrigin}${viewPathFor(input.articleUrl)}` };
	return { kind: "original", url: input.originalUrl };
}
