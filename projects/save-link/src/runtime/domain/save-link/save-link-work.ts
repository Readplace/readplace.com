import { createHash } from "node:crypto";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	ComprehensiveCrawl,
	CrawlArticleResult,
	SimpleCrawl,
	ThumbnailImage,
} from "@packages/crawl-article";
import { PDF_DETECTED_REASON } from "@packages/crawl-article";
import {
	markCrawlFailed,
	markCrawlUnsupported,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import { ArticleResourceUniqueId } from "./article-resource-unique-id";
import type { ParseHtml } from "../article-parser/article-parser.types";
import type { DownloadMedia, DownloadedMedia } from "./download-media";
import type { PutImageObject } from "../../providers/article-store/s3-put-image-object";
import type { UpdateFetchTimestamp } from "./update-fetch-timestamp-handler";
import type { LogCrawlOutcome, LogParseError } from "@packages/hutch-infra-components";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import { estimatedReadTimeFromWordCount } from "./estimated-read-time";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";

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
	simpleCrawl: SimpleCrawl;
	comprehensiveCrawl: ComprehensiveCrawl;
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
}): { saveLinkWork: (url: string) => Promise<SaveLinkWorkResult> } {
	const {
		simpleCrawl,
		comprehensiveCrawl,
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

	const recordTerminalUnsupported = async (
		url: string,
		reason: string,
	): Promise<void> => {
		logParseError({ url, reason: `crawl-unsupported: ${reason}` });
		await transitionAndPersist(markCrawlUnsupported, {
			url,
			input: {
				reason: { kind: "non-html-content", contentType: reason },
			},
		});
		await emitTier1Failure(url);
	};

	const saveLinkWork = async (url: string): Promise<SaveLinkWorkResult> => {
		await markCrawlStage({ url, stage: "crawl-fetching" });
		const simpleResult = await simpleCrawl({ url, fetchThumbnail: true });

		/**
		 * Compose the simple → comprehensive fall-through inline so we can
		 * interleave the `comprehensive-fetching` stage marker. The composed
		 * `initCrawlArticle` cannot do this because the stage write must
		 * land in DynamoDB between the simple result and the comprehensive
		 * fetch, not after.
		 */
		let crawlResult: CrawlArticleResult;
		let usedComprehensivePath = false;
		if (simpleResult.status === "unsupported" && simpleResult.reason === PDF_DETECTED_REASON) {
			usedComprehensivePath = true;
			await markCrawlStage({ url, stage: "comprehensive-fetching" });
			/**
			 * Server only commits two coarse stages — `comprehensive-fetching` and
			 * `comprehensive-extracting` — and the client smoother interpolates the
			 * percentage between them. Writing for every page on a 50-page PDF
			 * would be 50 DynamoDB UpdateItems per article; latched on the first
			 * page only, it is exactly one.
			 */
			let extractingMarked = false;
			crawlResult = await comprehensiveCrawl({
				url,
				fetchThumbnail: true,
				onPdfPage: ({ pageIndex }) => {
					if (extractingMarked || pageIndex !== 1) return;
					extractingMarked = true;
					markCrawlStage({ url, stage: "comprehensive-extracting" }).catch((error: unknown) => {
						logger.warn(`${logPrefix} comprehensive-extracting stage write failed`, {
							url,
							error: String(error),
						});
					});
				},
			});
		} else {
			crawlResult = simpleResult;
		}

		if (crawlResult.status === "unsupported") {
			// Permanently non-html origin (PDF that failed extraction, image, archive,
			// …). The aggregate transition flips both axes atomically —
			// crawl=unsupported AND summary=skipped("crawl-unsupported") — so the
			// summary canary cannot see a half-written row pending forever between
			// two updates. No throw: this is a successful terminal outcome, not work
			// to retry.
			await recordTerminalUnsupported(url, crawlResult.reason);
			return "unsupported";
		}
		if (crawlResult.status !== "fetched") {
			const reason = `crawl-${crawlResult.status}`;
			logParseError({ url, reason });
			await emitTier1Failure(url);
			throw new Error(`crawl failed for ${url}: ${reason}`);
		}
		if (!usedComprehensivePath) {
			await markCrawlStage({ url, stage: "crawl-fetched" });
		}

		const parseResult = parseHtml({ url, html: crawlResult.html });
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
