import { createHash } from "node:crypto";
import type { HutchLogger } from "@packages/hutch-logger";
import type { CrawlArticle, ThumbnailImage } from "@packages/crawl-article";
import type {
	MarkCrawlFailed,
	MarkCrawlStage,
	MarkCrawlUnsupported,
} from "../crawl-article-state/article-crawl.types";
import type { MarkSummarySkipped } from "../generate-summary/article-summary.types";
import { ArticleResourceUniqueId } from "./article-resource-unique-id";
import type { ParseHtml } from "../article-parser/article-parser.types";
import type { DownloadMedia, DownloadedMedia } from "./download-media";
import type { PutImageObject } from "./s3-put-image-object";
import type { UpdateFetchTimestamp } from "./update-fetch-timestamp-handler";
import type { LogCrawlOutcome, LogParseError } from "@packages/hutch-infra-components";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import { estimatedReadTimeFromWordCount } from "./estimated-read-time";
import type { PutTierSource } from "../select-content/put-tier-source";

export type ProcessContent = (params: { html: string; media: DownloadedMedia[] }) => Promise<string>;

/**
 * `"tier-1-written"` — the worker fetched, parsed, and wrote a tier-1 source.
 * The caller should publish TierContentExtractedEvent so the selector runs.
 *
 * `"unsupported"` — the origin returned a non-html content type (PDF, image,
 * archive, …). The row is now in the terminal `crawlStatus="unsupported"`
 * state. No tier-1 source was written; the caller must NOT publish
 * TierContentExtractedEvent or the selector will trip on a missing source.
 */
export type SaveLinkWorkResult = "tier-1-written" | "unsupported";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSaveLinkWork(deps: {
	crawlArticle: CrawlArticle;
	parseHtml: ParseHtml;
	putTierSource: PutTierSource;
	putImageObject: PutImageObject;
	updateFetchTimestamp: UpdateFetchTimestamp;
	markCrawlFailed: MarkCrawlFailed;
	markCrawlUnsupported: MarkCrawlUnsupported;
	markCrawlStage: MarkCrawlStage;
	markSummarySkipped: MarkSummarySkipped;
	downloadMedia: DownloadMedia;
	processContent: ProcessContent;
	imagesCdnBaseUrl: string;
	now: () => Date;
	logger: HutchLogger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	readTierSnapshot: ReadTierSnapshot;
	logPrefix: string;
}): { saveLinkWork: (url: string) => Promise<SaveLinkWorkResult> } {
	const {
		crawlArticle,
		parseHtml,
		putTierSource,
		putImageObject,
		updateFetchTimestamp,
		markCrawlFailed,
		markCrawlUnsupported,
		markCrawlStage,
		markSummarySkipped,
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

	const saveLinkWork = async (url: string): Promise<SaveLinkWorkResult> => {
		await markCrawlStage({ url, stage: "crawl-fetching" });
		const crawlResult = await crawlArticle({ url, fetchThumbnail: true });
		if (crawlResult.status === "unsupported") {
			// Permanently non-html origin (PDF, image, archive, …). Flip directly
			// to the terminal `unsupported` state and mark the summary axis
			// skipped so the canary doesn't keep flagging the row. No throw:
			// this is a successful terminal outcome, not work to retry.
			logParseError({ url, reason: `crawl-unsupported: ${crawlResult.reason}` });
			await markCrawlUnsupported({ url, reason: crawlResult.reason });
			await markSummarySkipped({ url, reason: "crawl-unsupported" });
			await emitTier1Failure(url);
			return "unsupported";
		}
		if (crawlResult.status !== "fetched") {
			const reason = `crawl-${crawlResult.status}`;
			logParseError({ url, reason });
			await emitTier1Failure(url);
			throw new Error(`crawl failed for ${url}: ${reason}`);
		}
		await markCrawlStage({ url, stage: "crawl-fetched" });

		const parseResult = parseHtml({ url, html: crawlResult.html });
		if (!parseResult.ok) {
			logParseError({ url, reason: parseResult.reason });
			// Parse failures are terminal: re-running the worker against the
			// same HTML will re-fail the same way. Flip the crawl state to
			// `failed` immediately so readers and the Tier 1+ canary see the
			// terminal state on the next poll, instead of waiting for SQS
			// retries → DLQ (~90s+) before the DLQ handler updates it.
			await markCrawlFailed({ url, reason: parseResult.reason });
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

async function uploadThumbnail(args: {
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
