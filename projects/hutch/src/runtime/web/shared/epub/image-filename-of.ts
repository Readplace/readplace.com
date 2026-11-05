import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { isPrivateItemUrl } from "@packages/domain/article";
import { privateMediaImageFilenameOf } from "./private-media-image";

const SAFE_IMAGE_FILENAME = /^[A-Za-z0-9._-]+\.(jpg|jpeg|png|gif|webp|avif|svg)$/i;
const OWNED_IMAGE_FILENAME = /^attempts\/(?:[a-f0-9]{64}\/[a-f0-9]{64}|[a-f0-9]{32}\/[a-f0-9]{32})\.(jpg|jpeg|png|gif|webp|avif|svg)$/;

export function embeddableImageFilename(params: {
	src: string;
	imagePrefix: string;
}): string | undefined {
	let pathname: string;
	try {
		pathname = new URL(params.src).pathname;
	} catch {
		return undefined;
	}
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return undefined;
	}
	const prefix = `/${params.imagePrefix}`;
	if (!decoded.startsWith(prefix)) return undefined;
	const filename = decoded.slice(prefix.length);
	if (!SAFE_IMAGE_FILENAME.test(filename) && !OWNED_IMAGE_FILENAME.test(filename)) return undefined;
	return filename;
}

export function imageFilenameOf(articleUrl: string): (src: string) => string | undefined {
	if (isPrivateItemUrl(articleUrl)) return privateMediaImageFilenameOf(articleUrl);
	const imagePrefix = ArticleResourceUniqueId.parse(articleUrl).toS3ImagePrefix();
	return (src) => embeddableImageFilename({ src, imagePrefix });
}
