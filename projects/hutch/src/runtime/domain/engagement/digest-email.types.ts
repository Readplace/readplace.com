import type { ReaderArticleHashId } from "@packages/domain/article";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import type { EmailAttachment } from "@packages/provider-contracts/email";
import type { BookChapter } from "../readlist/book-chapter.types";

export interface QueueDigestEmailItem {
	articleId: ReaderArticleHashId;
	title: string;
	siteName: string;
	preview: string;
}

export type BuildQueueDigestBook = (input: {
	subject: string;
	sendId: string;
	sentAt: Date;
	chapters: readonly BookChapter[];
}) => Promise<EmailAttachment>;

export type RenderedEmail = {
	subject: string;
	headers: Record<string, string>;
	to: (mediaType: "text/html" | "text/plain") => string;
};

export type RenderStarterEmail = (input: {
	starter: { readlist: ReadlistSlug; campaignId: string };
	items: QueueDigestEmailItem[];
	links: { appOrigin: string; sendId: string; unsubscribeToken: string };
}) => RenderedEmail;

export type PreviewSummary = (summary: GeneratedSummary | undefined) => string;
