import assert from "node:assert";
import { deflateSync, strToU8 } from "fflate";
import { type ArticleBody, type ArticleDestinationUrl, articleDestinationHost } from "@packages/domain/article";
import type { ReadArticleImage } from "@packages/provider-contracts/article-store";
import { articleEpubXhtml, collectArticleImages } from "./epub-xhtml";
import { type ArticleFrontMatter, articleFrontMatterXhtml, COLOPHON_XHTML } from "./article-front-matter";
import { epubImageBudgetFor } from "./epub-image-budget";
import { buildEpub } from "./epub-package";
import type { ReaderHighlights } from "../article-body/reader-slot/mark-highlights";
import { prepareReaderContent, WHOLE_DOCUMENT_SECTION } from "../article-body/reader-slot/reader-content";
import { noteReferencedChapterXhtml } from "./highlights-xhtml";
import type { LogError } from "@packages/logger";

type SkippedImage = { filename: string; bytes: number };

export type ArticleEpubBuild = {
	bytes: Uint8Array;
	embeddedBytes: number;
	skippedOverBudget: readonly SkippedImage[];
};

export type BuildArticleEpub = (
	params: ArticleFrontMatter & {
		articleUrl: string;
		contentHtml: ArticleBody;
		highlighted?: { highlights: ReaderHighlights; appOrigin: string };
	},
) => Promise<ArticleEpubBuild>;

function chapterBodyOf(params: {
	articleUrl: string;
	contentHtml: ArticleBody;
	highlighted?: { highlights: ReaderHighlights; appOrigin: string };
}): { bodyHtml: string; highlightsHtml: string } {
	const { highlighted } = params;
	if (highlighted === undefined || highlighted.highlights.rows.length === 0) {
		return { bodyHtml: params.contentHtml, highlightsHtml: "" };
	}
	const prepared = prepareReaderContent({
		content: params.contentHtml,
		appOrigin: highlighted.appOrigin,
		url: params.articleUrl,
		section: WHOLE_DOCUMENT_SECTION,
		highlights: highlighted.highlights,
	});
	assert(prepared.kind === "whole", "an EPUB chapter is never split into reader sections");
	return noteReferencedChapterXhtml({ html: prepared.html, states: prepared.states });
}

type BuildArticleEpubDependencies = {
	readArticleImage: ReadArticleImage;
	logError: LogError;
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
		const frontMatter = articleFrontMatterXhtml({
			title: params.title,
			siteName: params.siteName,
			excerpt: params.excerpt,
			summary: params.summary,
		});

		const { bodyHtml, highlightsHtml } = chapterBodyOf(params);
		const chapterHtml = frontMatter + bodyHtml + highlightsHtml + COLOPHON_XHTML;
		const imageBudget = epubImageBudgetFor({ deflatedBodyBytes: deflateSync(strToU8(chapterHtml)).length });

		const candidates = collectArticleImages({
			contentHtml: bodyHtml,
			articleUrl: params.articleUrl,
		});

		const images: { filename: string; body: Uint8Array }[] = [];
		const skippedOverBudget: SkippedImage[] = [];
		let usedBytes = 0;
		for (const candidate of candidates) {
			const bytes = await readArticleImage({ url: params.articleUrl, filename: candidate.filename });
			if (!bytes) {
				logError(`[ArticleEpub] image ${candidate.filename} missing from store; skipping`);
				continue;
			}
			if (usedBytes + bytes.length > imageBudget) {
				skippedOverBudget.push({ filename: candidate.filename, bytes: bytes.length });
				continue;
			}
			usedBytes += bytes.length;
			images.push({ filename: candidate.filename, body: bytes });
		}

		const xhtml = articleEpubXhtml({
			contentHtml: chapterHtml,
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
