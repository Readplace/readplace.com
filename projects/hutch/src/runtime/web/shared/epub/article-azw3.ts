import type { ReadArticleImage } from "@packages/provider-contracts/article-store";
import {
	articleDownloadFilename,
	initBuildArticleEpubWithImageFilter,
	type BuildArticleEpub,
} from "./article-epub";

const KINDLE_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["jpg", "jpeg", "png", "gif"]);
const MAX_AZW3_CONTENT_BYTES = 32 * 1024 * 1024;

export type ConvertEpubToAzw3 = (epub: Uint8Array) => Promise<Uint8Array>;

function canEmbedInAzw3(filename: string): boolean {
	return KINDLE_IMAGE_EXTENSIONS.has(filename.slice(filename.lastIndexOf(".") + 1).toLowerCase());
}

export function azw3Filename(params: { title: string; articleUrl: string }): string {
	return articleDownloadFilename({ ...params, extension: "azw3" });
}

export function initBuildArticleAzw3(deps: {
	readArticleImage: ReadArticleImage;
	logError: (message: string, error?: Error) => void;
	now: () => Date;
	convertEpubToAzw3: ConvertEpubToAzw3;
	maxContentBytes?: number;
}): BuildArticleEpub {
	const buildEpub = initBuildArticleEpubWithImageFilter({
		readArticleImage: deps.readArticleImage,
		logError: deps.logError,
		now: deps.now,
		canEmbedImage: canEmbedInAzw3,
	});
	const maxContentBytes = deps.maxContentBytes ?? MAX_AZW3_CONTENT_BYTES;
	return (params) => {
		if (Buffer.byteLength(params.contentHtml, "utf8") > maxContentBytes) {
			return Promise.reject(new Error(`AZW3 article content exceeds ${maxContentBytes} bytes`));
		}
		return buildEpub(params).then(deps.convertEpubToAzw3);
	};
}
