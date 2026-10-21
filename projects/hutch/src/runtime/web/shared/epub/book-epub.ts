import assert from "node:assert";
import type { ReadArticleImage } from "@packages/provider-contracts/article-store";
import { type ArticleFrontMatter, articleFrontMatterXhtml } from "./article-front-matter";
import { type EpubChapter, type EpubImage, packageEpub } from "./epub-package";
import { chapterEpubXhtml, collectArticleImages } from "./epub-xhtml";
import type { ArticleBody } from "@packages/domain/article";

export type BookChapter = ArticleFrontMatter & { articleUrl: string; contentHtml: ArticleBody };

export type BuildBookEpub = (params: {
	title: string;
	identifier: string;
	modifiedAt: Date;
	chapters: readonly BookChapter[];
}) => Promise<Uint8Array>;

export function initBuildBookEpub(deps: {
	readArticleImage: ReadArticleImage;
	maxImageBytes: number;
}): BuildBookEpub {
	return async (params) => {
		const chapters: EpubChapter[] = [];
		const images: EpubImage[] = [];
		let usedBytes = 0;

		for (const [index, chapter] of params.chapters.entries()) {
			const number = String(index + 1).padStart(2, "0");
			const imageHrefs = new Map<string, string>();
			for (const candidate of collectArticleImages(chapter)) {
				const body = await deps.readArticleImage({ url: chapter.articleUrl, filename: candidate.filename });
				assert(body, `[BookEpub] image ${candidate.filename} of ${chapter.articleUrl} is missing from the store`);
				if (usedBytes + body.length > deps.maxImageBytes) continue;
				usedBytes += body.length;
				const href = `images/${number}/${candidate.filename}`;
				imageHrefs.set(candidate.filename, href);
				images.push({ href, body });
			}
			chapters.push({
				id: `chapter-${number}`,
				href: `chapter-${number}.xhtml`,
				title: chapter.title,
				xhtml: chapterEpubXhtml({
					contentHtml: articleFrontMatterXhtml(chapter) + chapter.contentHtml,
					title: chapter.title,
					articleUrl: chapter.articleUrl,
					imageHrefs,
				}),
			});
		}

		return packageEpub({
			title: params.title,
			language: "en",
			identifier: params.identifier,
			modifiedAt: params.modifiedAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
			chapters,
			images,
		});
	};
}
