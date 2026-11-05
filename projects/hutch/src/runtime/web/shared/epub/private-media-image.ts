import { ReaderArticleHashId } from "@packages/domain/article";
import { MediaImageFileSchema } from "@packages/media-contracts";

const PRIVATE_MEDIA_SRC = /^\/queue\/([^/]+)\/media\/([^/]+)$/;

export function privateMediaImageFilenameOf(articleUrl: string): (src: string) => string | undefined {
	const routeId = ReaderArticleHashId.from(articleUrl).value;
	return (src) => {
		const match = PRIVATE_MEDIA_SRC.exec(src);
		if (match === null || match[1] !== routeId) return undefined;
		const file = MediaImageFileSchema.safeParse(match[2]);
		return file.success ? file.data : undefined;
	};
}
