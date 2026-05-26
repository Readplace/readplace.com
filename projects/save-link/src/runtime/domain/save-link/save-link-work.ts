import { createHash } from "node:crypto";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	CrawlArticleResult,
	SimpleCrawl,
	ThumbnailImage,
} from "@packages/crawl-article";
import {
	markCrawlFailed,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import { ArticleResourceUniqueId } from "./article-resource-unique-id";
import type { ParseHtml } from "@packages/article-parser";
import type { DownloadMedia, DownloadedMedia } from "./download-media";
import type { PutImageObject } from "../../providers/article-store/s3-put-image-object";
import type { UpdateFetchTimestamp } from "./update-fetch-timestamp-handler";
import type { LogCrawlOutcome, LogParseError } from "@packages/hutch-infra-components";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import { estimatedReadTimeFromWordCount } from "./estimated-read-time";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";

export type ProcessContent = (params: { html: string; media: DownloadedMedia[] }) => Promise<string>;

/**
 * `"tier-1-written"` — the worker fetched, parsed, and wrote a tier-1 source.
 * The caller should publish TierContentExtractedEvent so the selector runs.
 *
 * `"tier-1-deferred"` — the simple crawl reported `unsupported` so the worker
 * emitted `SimpleCrawlUnsupportedEvent`. The policy Lambda subscribes and
 * dispatches `ComprehensiveCrawlCommand` to the dedicated PDF-handling
 * Lambda. The row stays in its current non-terminal state (the comprehensive
 * Lambda owns the next status transition + any downstream event). The caller
 * must NOT publish a follow-up event itself; the comprehensive Lambda emits
 * the appropriate event after it finishes (TierContentExtractedEvent or
 * RecrawlContentExtractedEvent).
 *
 * Note: terminal `"unsupported"` is owned by the comprehensive-crawl Lambda's
 * own handler — save-link-work never decides "permanently unsupported"
 * directly anymore, since the simple crawl cannot distinguish a PDF (which
 * the comprehensive Lambda extracts) from a video/archive (which it does
 * not). All unsupported simple results flow through the event.
 */
export type SaveLinkWorkResult = "tier-1-written" | "tier-1-deferred";

export type SaveLinkWorkOptions = {
	userId?: string;
	recrawl?: boolean;
};

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSaveLinkWork(deps: {
	simpleCrawl: SimpleCrawl;
	emitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported;
	parseHtml: ParseHtml;
	putTierSource: PutTierSource;
	putImageObject: PutImageObject;
	updateFetchTimestamp: UpdateFetchTimestamp;
	transitionAndPersist: TransitionAndPersist;
	markCrawlStage: MarkCrawlStage;
	downloadMedia: DownloadMedia;
	processContent: ProcessContent;
	imagesCdnBaseUrl: string;
	now: () => Date;
	logger: HutchLogger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	readTierSnapshot: ReadTierSnapshot;
	logPrefix: string;
}): { saveLinkWork: (url: string, options?: SaveLinkWorkOptions) => Promise<SaveLinkWorkResult> } {
	const {
		simpleCrawl,
		emitSimpleCrawlUnsupported,
		parseHtml,
		putTierSource,
		putImageObject,
		updateFetchTimestamp,
		transitionAndPersist,
		markCrawlStage,
		downloadMedia,
		processContent,
		imagesCdnBaseUrl,
		now,
		logger,
		logParseError,
		logCrawlOutcome,
		readTierSnapshot,
		logPrefix,
	} = deps;

	const emitTier1Failure = async (url: string): Promise<void> => {
		const snapshot = await readTierSnapshot({ url });
		logCrawlOutcome({
			url,
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: snapshot.tier0Status,
			pickedTier: snapshot.pickedTier,
		});
	};

	const saveLinkWork = async (url: string, options?: SaveLinkWorkOptions): Promise<SaveLinkWorkResult> => {
		await markCrawlStage({ url, stage: "crawl-fetching" });
		const crawlResult: CrawlArticleResult = await simpleCrawl({ url, fetchThumbnail: true });

		if (crawlResult.status === "unsupported") {
			/*
			 * The simple crawl bailed because the origin returned a non-html body.
			 * We do not know yet whether it is a PDF (the comprehensive Lambda
			 * extracts and decides) or something the comprehensive path cannot
			 * handle either (image, archive, …). Emit unconditionally and
			 * let the policy → comprehensive Lambda chain's own `unsupported`
			 * branch flip the row terminal — that keeps the "two Lambdas can
			 * each return unsupported" matrix from being duplicated here.
			 *
			 * `comprehensive-fetching` is written before the emit so the
			 * reader's progress bar moves forward immediately; the comprehensive
			 * Lambda writes `comprehensive-extracting` once it starts pdfjs.
			 */
			await markCrawlStage({ url, stage: "comprehensive-fetching" });
			await emitSimpleCrawlUnsupported({ url, userId: options?.userId, recrawl: options?.recrawl });
			logger.info(`${logPrefix} tier-1 deferred to comprehensive crawl`, {
				url,
				reason: crawlResult.reason,
			});
			return "tier-1-deferred";
		}

		if (crawlResult.status !== "fetched") {
			const reason = `crawl-${crawlResult.status}`;
			logParseError({ url, reason });
			await emitTier1Failure(url);
			throw new Error(`crawl failed for ${url}: ${reason}`);
		}

		await markCrawlStage({ url, stage: "crawl-fetched" });

		const parseResult = parseHtml({
			url,
			html: crawlResult.html,
			thumbnailUrl: crawlResult.thumbnailUrl ?? null,
		});
		if (!parseResult.ok) {
			logParseError({ url, reason: parseResult.reason });
			// Parse failures are terminal: re-running the worker against the
			// same HTML will re-fail the same way. Flip the crawl state to
			// `failed` immediately so readers and the Tier 1+ canary see the
			// terminal state on the next poll, instead of waiting for SQS
			// retries → DLQ (~90s+) before the DLQ handler updates it.
			await transitionAndPersist(markCrawlFailed, {
				url,
				input: {
					reason: { kind: "parse-error", detail: parseResult.reason },
				},
			});
			await emitTier1Failure(url);
			throw new Error(`crawl failed for ${url}: ${parseResult.reason}`);
		}

		const { article } = parseResult;
		await markCrawlStage({ url, stage: "crawl-parsed" });
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);

		const media = await downloadMedia({
			html: article.content,
			articleUrl: url,
			articleResourceUniqueId,
		});

		const html = await processContent({ html: article.content, media });

		// Resolve the final imageUrl that lands in the metadata sidecar — the
		// CDN-cached thumbnail wins when the crawler fetched one, otherwise the
		// raw og:image / twitter:image URL Readability extracted. The selector
		// reads this when it promotes the winning tier to canonical.
		const resolvedImageUrl = crawlResult.thumbnailImage
			? await uploadThumbnail({
					thumbnailImage: crawlResult.thumbnailImage,
					articleResourceUniqueId,
					putImageObject,
					imagesCdnBaseUrl,
				})
			: article.imageUrl;
		await markCrawlStage({ url, stage: "crawl-metadata-written" });

		await putTierSource({
			url,
			tier: "tier-1",
			html,
			metadata: {
				title: article.title,
				siteName: article.siteName,
				excerpt: article.excerpt,
				wordCount: article.wordCount,
				estimatedReadTime: estimatedReadTimeFromWordCount(article.wordCount),
				imageUrl: resolvedImageUrl,
			},
		});
		await markCrawlStage({ url, stage: "crawl-content-uploaded" });

		await updateFetchTimestamp({
			url,
			contentFetchedAt: now().toISOString(),
			etag: crawlResult.etag,
			lastModified: crawlResult.lastModified,
		});

		const successSnapshot = await readTierSnapshot({ url });
		logCrawlOutcome({
			url,
			thisTier: "tier-1",
			thisTierStatus: "success",
			otherTierStatus: successSnapshot.tier0Status,
			pickedTier: successSnapshot.pickedTier,
		});

		logger.info(`${logPrefix} tier-1 source written`, {
			url,
			hasThumbnail: crawlResult.thumbnailImage ? 1 : 0,
		});
		return "tier-1-written";
	};

	return { saveLinkWork };
}

/** Shared with `comprehensive-crawl-handler` so both code paths upload
 * thumbnails to the same key shape. Keeping it here avoids a circular
 * import — the comprehensive handler depends on this module, not the other
 * way around. */
export async function uploadThumbnail(args: {
	thumbnailImage: ThumbnailImage;
	articleResourceUniqueId: ArticleResourceUniqueId;
	putImageObject: PutImageObject;
	imagesCdnBaseUrl: string;
}): Promise<string> {
	const { thumbnailImage, articleResourceUniqueId, putImageObject, imagesCdnBaseUrl } = args;
	const hash = createHash("sha256").update(thumbnailImage.url).digest("hex").slice(0, 16);
	const filename = `${hash}${thumbnailImage.extension}`;
	const key = articleResourceUniqueId.toS3ImageKey(filename);
	await putImageObject({ key, body: thumbnailImage.body, contentType: thumbnailImage.contentType });
	return articleResourceUniqueId.toImageCdnUrl({ baseUrl: imagesCdnBaseUrl, filename });
}
