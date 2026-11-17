import type { ReaderFailedVariant } from "@packages/article-state-types";
import type { ArticleBody, ItemMedia } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { NOT_AN_ARTICLE } from "./article-reader";

export type ReaderView =
	| { kind: "not-an-article" }
	| { kind: "loading" }
	| { kind: "succeeded" }
	| { kind: "failed"; contentUnavailable: boolean };

export function offersSaveTip(view: ReaderView): boolean {
	return view.kind === "failed";
}

export function readerContentUnavailable(view: ReaderView): boolean {
	return view.kind === "not-an-article" || (view.kind === "failed" && view.contentUnavailable);
}

export function readerNoticeOf(view: ReaderView): ReaderFailedVariant | undefined {
	return view.kind === "not-an-article" ? NOT_AN_ARTICLE : undefined;
}

const TRANSCRIPT_NOTICES = {
	"no-speech": "no-speech",
	"transcript-failed": "transcript-failed",
} as const satisfies Record<NonNullable<ItemMedia["transcript"]>, ReaderFailedVariant>;

export function transcriptNoticeOf(media: ItemMedia | undefined): ReaderFailedVariant | undefined {
	const transcript = media?.transcript;
	return transcript === undefined ? undefined : TRANSCRIPT_NOTICES[transcript];
}

export function isReaderViewShareable(input: { content: ArticleBody | undefined; crawl: ArticleCrawl | undefined }): boolean {
	return input.content !== undefined && (input.crawl === undefined || input.crawl.status === "ready");
}
