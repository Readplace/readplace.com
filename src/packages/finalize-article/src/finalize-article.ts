import assert from "node:assert";
import { planCoverageRepair, type ParseHtml } from "@packages/article-parser";
import {
	escapeHtmlText,
	extractThumbnailCandidates,
	type FetchThumbnailImage,
	type ThumbnailCascade,
	type ThumbnailImage,
	titleFromPathname,
} from "@packages/crawl-article";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	type ArticleCoverage,
	articleFromHostTitle,
	certifiesArticle,
	clipMetadataExcerpt,
	type CoverageOutcome,
	imageSavedFromHostExcerpt,
	isWorseOutcome,
	pageHostUrl,
} from "@packages/domain/article";
import { buildArticleCoverage, type CoverageRepairStatus } from "./article-coverage-report";
import type { DownloadMedia, DownloadedMedia } from "./download-media.types";
import { mediaFilename } from "./media-filename";
import type { PutImageObject, MediaWriteContext } from "./put-image-object.types";
import { estimatedReadTimeFromWordCount } from "./estimated-read-time";
import { isBareImageCapture } from "./is-bare-image-capture";
import { stripOversizedInlineImages } from "./strip-inline-image-data";

export type ProcessContent = (params: { html: string; media: DownloadedMedia[] }) => Promise<string>;

export type FinalizedArticle = {
	/** Processed body HTML with media URLs rewritten to the CDN. */
	html: string;
	metadata: {
		title: string;
		siteName: string;
		excerpt: string;
		wordCount: number;
		estimatedReadTime: number;
		imageUrl?: string;
		publishedOn?: string;
		directResourceKind?: "image" | "plain-text";
		coverage?: ArticleCoverage;
	};
};

export const UNREADABLE_ARTICLE: FinalizedArticle = {
	html: "",
	metadata: { title: "", siteName: "", excerpt: "", wordCount: 0, estimatedReadTime: 0 },
};

export type FinalizeArticleResult =
	| { ok: true; article: FinalizedArticle }
	| { ok: false; reason: string };

export type FinalizeArticle = (input: {
	writeContext?: MediaWriteContext;
	url: string;
	documentUrl: string;
	fetchedDocument?: true;
	html: string;
	/** The cascade the crawler already ran (SimpleCrawl with
	 * `fetchThumbnail: true`). Its presence is what tells the finalizer the
	 * candidates have already been walked, so an absent `image` means "attempted
	 * and found nothing", not "never tried" — without it the finalizer re-runs
	 * the identical cascade, doubling outbound requests and error volume exactly
	 * when an origin is already failing. Left unset by raw-HTML / comprehensive
	 * callers, which genuinely have not fetched and still need the finalizer to. */
	resolvedThumbnail?: ThumbnailCascade;
} & (
	| {
			/** Set by the crawler when the fetched body was itself an image. Routes the
			 * save to image synthesis (host the image, store an `<img>` body, skip
			 * Readability). The browser-extension raw-HTML save leaves this unset; the
			 * finalizer then detects a bare-image capture via `isBareImageCapture`. */
			mediaType?: "image";
		}
	| { mediaType: "plain-text"; plainText: string }
)) => Promise<FinalizeArticleResult>;

/**
 * The single source of truth for turning a fetched resource into the canonical
 * `{ html, metadata }` pair that gets persisted as a tier source. Every path
 * that produces an article representation routes through here: SimpleCrawl
 * save / recrawl, ComprehensiveCrawl PDF, stale-check refresh, browser-extension
 * raw-HTML save, dev in-memory wrappers.
 *
 * A resource is one of two shapes:
 *   - An HTML body → parseHtml → downloadMedia → processContent → fetch
 *     og:image (if not pre-fetched) → uploadThumbnail, so metadata.imageUrl
 *     points to the Readplace CDN when the image fetch succeeded, and otherwise
 *     to the first candidate the cascade did not prove unusable.
 *   - An image (the crawler tagged it `mediaType:"image"`, or the captured
 *     body is a bare-image page) → host the image on the CDN and store an
 *     `<img>` body with synthesised metadata. Readability is skipped: it
 *     extracts no text from an image and would persist an empty content body.
 */
export function initFinalizeArticle(deps: {
	parseHtml: ParseHtml;
	downloadMedia: DownloadMedia;
	processContent: ProcessContent;
	fetchThumbnailImage: FetchThumbnailImage;
	putImageObject: PutImageObject;
	imagesCdnBaseUrl: string;
}): FinalizeArticle {
	const {
		parseHtml,
		downloadMedia,
		processContent,
		fetchThumbnailImage,
		putImageObject,
		imagesCdnBaseUrl,
	} = deps;

	return async (input) => {
		if (input.mediaType === "plain-text") return finalizePlainTextArticle(input);

		/* Two-pass HTML parse is intentional: extractThumbnailCandidates uses
		 * linkedom for og:image / meta-tag extraction, while parseHtml uses
		 * Readability for content extraction — different libraries, different
		 * concerns, negligible overhead on article-sized documents. */
		const candidates = extractThumbnailCandidates({ html: input.html, baseUrl: input.documentUrl });

		if (input.mediaType === "image" || isBareImageCapture({ html: input.html, candidates, url: input.documentUrl })) {
			return finalizeImageArticle({
				url: input.url,
				writeContext: input.writeContext,
				documentUrl: input.documentUrl,
				candidates,
				resolvedThumbnail: input.resolvedThumbnail,
				mediaType: input.mediaType,
				fetchThumbnailImage,
				putImageObject,
				imagesCdnBaseUrl,
			});
		}

		const thumbnail =
			input.resolvedThumbnail ?? (await fetchThumbnailImage({ candidates, referer: input.documentUrl }));
		const thumbnailUrl = firstUsableCandidate(thumbnail) ?? null;

		const parseResult = parseHtml({
			url: input.url,
			documentUrl: input.documentUrl,
			...(input.fetchedDocument && { fetchedDocument: input.fetchedDocument }),
			html: input.html,
			thumbnailUrl,
		});
		if (!parseResult.ok) return { ok: false, reason: parseResult.reason };

		const { article, coverage: inspections } = parseResult;
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(input.writeContext?.url ?? input.url);
		const plan = planCoverageRepair({ baselineContent: article.content, inspections });

		const runMedia = async (body: string): Promise<FinalizedBody> => {
			/* Drop multi-MB inline base64 images before the body is persisted as the
			 * tier source; downstream finalize handlers re-load the whole source and
			 * OOM on pages that inline tens of MB of images. http(s) <img>
			 * sources are untouched, so they are still mirrored to the CDN. */
			const content = stripOversizedInlineImages(body);
			const media = await downloadMedia({
				html: content,
				writeContext: input.writeContext,
				referer: input.documentUrl,
				articleResourceUniqueId,
			});
			return { html: await processContent({ html: content, media }), media };
		};
		const verifyAll = (finalized: FinalizedBody): CoverageOutcome[] => {
			const mediaUrls = new Map(finalized.media.map((item) => [item.originalUrl, item.cdnUrl]));
			return plan.entries.map((entry) =>
				entry.inspection.kind === "inspected"
					? entry.inspection.verify({ readerHtml: finalized.html, media: mediaUrls })
					: entry.baseline,
			);
		};

		const attempt =
			plan.repair === undefined
				? undefined
				: await attemptCoverageRepair({
						repair: plan.repair,
						baselines: plan.entries.map((entry) => entry.baseline),
						runMedia,
						verifyAll,
					});
		const applied = attempt?.status === "applied" ? attempt : undefined;
		const chosen = applied ? applied.finalized : await runMedia(article.content);
		const finals = applied ? applied.finals : verifyAll(chosen);
		const wordCount = applied ? applied.wordCount : article.wordCount;
		const coverage = buildArticleCoverage({
			sourceHtml: input.html,
			html: chosen.html,
			plan,
			finals,
			repairStatus: attempt ? attempt.status : "none",
		});
		const { html } = chosen;

		const thumbnailImage = thumbnail.image;
		const imageUrl = thumbnailImage
			? await uploadThumbnail({
					thumbnailImage,
					writeContext: input.writeContext,
					articleResourceUniqueId,
					putImageObject,
					imagesCdnBaseUrl,
				})
			: article.imageUrl;

		return {
			ok: true,
			article: {
				html,
				metadata: {
					title: article.title,
					siteName: article.siteName,
					excerpt: article.excerpt,
					wordCount,
					estimatedReadTime: estimatedReadTimeFromWordCount(wordCount),
					imageUrl,
					publishedOn: article.publishedOn,
					...(coverage && { coverage }),
				},
			},
		};
	};
}

type FinalizedBody = { html: string; media: DownloadedMedia[] };

async function attemptCoverageRepair(params: {
	repair: { index: number; alternative: { content: string; wordCount: number } };
	baselines: readonly CoverageOutcome[];
	runMedia: (body: string) => Promise<FinalizedBody>;
	verifyAll: (finalized: FinalizedBody) => CoverageOutcome[];
}): Promise<
	| { status: Exclude<CoverageRepairStatus, "none" | "applied"> }
	| { status: "applied"; finalized: FinalizedBody; finals: CoverageOutcome[]; wordCount: number }
> {
	let finalized: FinalizedBody;
	try {
		finalized = await params.runMedia(params.repair.alternative.content);
	} catch {
		return { status: "media-failed" };
	}
	const finals = params.verifyAll(finalized);
	const repairedOutcome = finals[params.repair.index];
	assert(repairedOutcome, "the repairing rule has a final outcome");
	const regressed =
		!certifiesArticle(repairedOutcome) ||
		finals.some((next, index) => {
			const previous = params.baselines[index];
			assert(previous, "every final outcome has a baseline");
			return isWorseOutcome({ next, previous });
		});
	return regressed ? { status: "regressed" } : { status: "applied", finalized, finals, wordCount: params.repair.alternative.wordCount };
}

function finalizePlainTextArticle(input: {
	url: string;
	documentUrl: string;
	plainText: string;
}): FinalizeArticleResult {
	const text = input.plainText;
	if (text.trim() === "") return { ok: false, reason: "Plain-text response is empty" };
	let pageUrl: URL;
	try {
		new URL(input.url);
		pageUrl = pageHostUrl({ savedUrl: input.url, documentUrl: input.documentUrl });
	} catch {
		return { ok: false, reason: "Invalid URL" };
	}
	const { hostname, pathname } = pageUrl;
	const wordCount = text.trim().split(/\s+/).length;
	return {
		ok: true,
		article: {
			html: `<pre><code>${escapeHtmlText(text)}</code></pre>`,
			metadata: {
				title: titleFromPathname(pathname) || articleFromHostTitle(hostname),
				siteName: hostname,
				excerpt: clipMetadataExcerpt(text.trim().replace(/\s+/g, " ")),
				wordCount,
				estimatedReadTime: estimatedReadTimeFromWordCount(wordCount),
				directResourceKind: "plain-text",
			},
		},
	};
}

/**
 * Build the canonical article for an image resource: host the bytes on the CDN
 * (reusing the pre-fetched bytes when the crawler already has them, else
 * fetching the bare-image candidate) and store an `<img>` body. The title is
 * the image filename; word count is zero, so the summary step skips and the
 * reader renders the image directly. When the image *fetch* fails (the origin
 * blocked the hotlink) the body falls back to the origin URL so the reader
 * still shows something rather than the empty-content dead-end; an upload
 * failure propagates and fails the save.
 */
async function finalizeImageArticle(args: {
	writeContext?: MediaWriteContext;
	url: string;
	documentUrl: string;
	candidates: string[];
	resolvedThumbnail: ThumbnailCascade | undefined;
	mediaType?: "image";
	fetchThumbnailImage: FetchThumbnailImage;
	putImageObject: PutImageObject;
	imagesCdnBaseUrl: string;
}): Promise<{ ok: true; article: FinalizedArticle }> {
	const { url, documentUrl, candidates, resolvedThumbnail, fetchThumbnailImage, putImageObject, imagesCdnBaseUrl } = args;
	const { hostname, pathname } = pageHostUrl({ savedUrl: url, documentUrl });
	const title = titleFromPathname(pathname) || hostname;
	const articleResourceUniqueId = ArticleResourceUniqueId.parse(args.writeContext?.url ?? url);

	const thumbnail = resolvedThumbnail ?? (await fetchThumbnailImage({ candidates, referer: documentUrl }));
	const image = thumbnail.image;
	const imageUrl = image
		? await uploadThumbnail({ writeContext: args.writeContext, thumbnailImage: image, articleResourceUniqueId, putImageObject, imagesCdnBaseUrl })
		: (firstUsableCandidate(thumbnail) ?? documentUrl);

	return {
		ok: true,
		article: {
			html: `<figure><img src="${escapeHtmlText(imageUrl)}" alt="${escapeHtmlText(title)}" loading="lazy"></figure>`,
			metadata: {
				title,
				siteName: hostname,
				excerpt: imageSavedFromHostExcerpt(hostname),
				wordCount: 0,
				estimatedReadTime: estimatedReadTimeFromWordCount(0),
				imageUrl,
				...(args.mediaType === "image" && image ? { directResourceKind: "image" } : {}),
			},
		},
	};
}

function firstUsableCandidate(thumbnail: ThumbnailCascade): string | undefined {
	return thumbnail.fetched.find((candidate) => !thumbnail.provenUnusable.includes(candidate));
}

async function uploadThumbnail(args: {
	writeContext?: MediaWriteContext;
	thumbnailImage: ThumbnailImage;
	articleResourceUniqueId: ArticleResourceUniqueId;
	putImageObject: PutImageObject;
	imagesCdnBaseUrl: string;
}): Promise<string> {
	const { thumbnailImage, articleResourceUniqueId, putImageObject, imagesCdnBaseUrl } = args;
	const filename = mediaFilename({ sourceUrl: thumbnailImage.url, body: thumbnailImage.body, extension: thumbnailImage.extension, writeContext: args.writeContext });
	const key = articleResourceUniqueId.toS3ImageKey(filename);
	await putImageObject({ key, body: thumbnailImage.body, contentType: thumbnailImage.contentType, writeContext: args.writeContext });
	return articleResourceUniqueId.toImageCdnUrl({ baseUrl: imagesCdnBaseUrl, filename });
}
