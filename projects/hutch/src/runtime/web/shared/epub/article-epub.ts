import { articleHostFrom } from "@packages/web-analytics";
import type { ReadArticleImage } from "@packages/provider-contracts/article-store";
import { articleEpubXhtml, collectArticleImages } from "./epub-xhtml";
import { buildEpub } from "./epub-package";

const MAX_EPUB_IMAGE_BYTES = 3_500_000;

export type BuildArticleEpub = (params: {
	articleUrl: string;
	title: string;
	contentHtml: string;
}) => Promise<Uint8Array>;

type BuildArticleEpubDependencies = {
	readArticleImage: ReadArticleImage;
	logError: (message: string, error?: Error) => void;
	now: () => Date;
};

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

export function articleDownloadFilename(params: {
	title: string;
	articleUrl: string;
	extension: string;
}): string {
	const titleSlug = slugify(params.title);
	if (titleSlug) return `${titleSlug}.${params.extension}`;
	return `${slugify(articleHostFrom(params.articleUrl))}.${params.extension}`;
}

export function epubFilename(params: { title: string; articleUrl: string }): string {
	return articleDownloadFilename({ ...params, extension: "epub" });
}

export function initBuildArticleEpub(deps: BuildArticleEpubDependencies): BuildArticleEpub {
	return initBuildArticleEpubWithImageFilter({ ...deps, canEmbedImage: () => true });
}

export function initBuildArticleEpubWithImageFilter(
	deps: BuildArticleEpubDependencies & { canEmbedImage: (filename: string) => boolean },
): BuildArticleEpub {
	const { readArticleImage, logError, now } = deps;

	return async (params: {
		articleUrl: string;
		title: string;
		contentHtml: string;
	}): Promise<Uint8Array> => {
		const candidates = collectArticleImages({
			contentHtml: params.contentHtml,
			articleUrl: params.articleUrl,
		});

		const images: { filename: string; body: Uint8Array }[] = [];
		let usedBytes = 0;
		for (const candidate of candidates) {
			if (!deps.canEmbedImage(candidate.filename)) continue;
			const bytes = await readArticleImage({ url: params.articleUrl, filename: candidate.filename });
			if (!bytes) {
				logError(`[ArticleEpub] image ${candidate.filename} missing from store; skipping`);
				continue;
			}
			if (usedBytes + bytes.length > MAX_EPUB_IMAGE_BYTES) {
				logError(`[ArticleEpub] image ${candidate.filename} over the embed budget; skipping`);
				continue;
			}
			usedBytes += bytes.length;
			images.push({ filename: candidate.filename, body: bytes });
		}

		const xhtml = articleEpubXhtml({
			contentHtml: params.contentHtml,
			title: params.title,
			articleUrl: params.articleUrl,
			embeddedFilenames: images.map((image) => image.filename),
		});

		return buildEpub({
			title: params.title,
			language: "en",
			identifier: params.articleUrl,
			modifiedAt: now().toISOString().replace(/\.\d{3}Z$/, "Z"),
			xhtml,
			images,
		});
	};
}
