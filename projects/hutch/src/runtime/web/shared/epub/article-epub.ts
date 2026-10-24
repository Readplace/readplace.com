import { type ArticleBody, type ArticleDestinationUrl, articleDestinationHost } from "@packages/domain/article";
import type { ReadArticleImage } from "@packages/provider-contracts/article-store";
import { articleEpubXhtml, collectArticleImages } from "./epub-xhtml";
import { type ArticleFrontMatter, articleFrontMatterXhtml } from "./article-front-matter";
import { buildEpub } from "./epub-package";

const MAX_EPUB_IMAGE_BYTES = 3_500_000;

export type ArticleEpubBuild = {
	bytes: Uint8Array;
	embeddedBytes: number;
	skippedOverBudget: readonly { filename: string; bytes: number }[];
};

export type BuildArticleEpub = (
	params: ArticleFrontMatter & { articleUrl: string; contentHtml: ArticleBody },
) => Promise<ArticleEpubBuild>;

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

export function epubFilename(params: { title: string; destinationUrl: ArticleDestinationUrl }): string {
	const titleSlug = slugify(params.title);
	if (titleSlug) return `${titleSlug}.epub`;
	return `${slugify(articleDestinationHost(params.destinationUrl))}.epub`;
}

export function initBuildArticleEpub(deps: BuildArticleEpubDependencies): BuildArticleEpub {
	const { readArticleImage, logError, now } = deps;

	return async (params): Promise<ArticleEpubBuild> => {
		const candidates = collectArticleImages({
			contentHtml: params.contentHtml,
			articleUrl: params.articleUrl,
		});

		const images: { filename: string; body: Uint8Array }[] = [];
		const skippedOverBudget: { filename: string; bytes: number }[] = [];
		let usedBytes = 0;
		for (const candidate of candidates) {
			const bytes = await readArticleImage({ url: params.articleUrl, filename: candidate.filename });
			if (!bytes) {
				logError(`[ArticleEpub] image ${candidate.filename} missing from store; skipping`);
				continue;
			}
			if (usedBytes + bytes.length > MAX_EPUB_IMAGE_BYTES) {
				skippedOverBudget.push({ filename: candidate.filename, bytes: bytes.length });
				continue;
			}
			usedBytes += bytes.length;
			images.push({ filename: candidate.filename, body: bytes });
		}

		const frontMatter = articleFrontMatterXhtml({
			title: params.title,
			siteName: params.siteName,
			excerpt: params.excerpt,
			summary: params.summary,
		});

		const xhtml = articleEpubXhtml({
			contentHtml: frontMatter + params.contentHtml,
			title: params.title,
			articleUrl: params.articleUrl,
			embeddedFilenames: images.map((image) => image.filename),
		});

		const epubBytes = buildEpub({
			title: params.title,
			language: "en",
			identifier: params.articleUrl,
			modifiedAt: now().toISOString().replace(/\.\d{3}Z$/, "Z"),
			xhtml,
			images,
		});
		return { bytes: epubBytes, embeddedBytes: usedBytes, skippedOverBudget };
	};
}
