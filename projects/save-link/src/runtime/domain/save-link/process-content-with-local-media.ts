import type { DownloadedMedia } from "./download-media";

export type RewriteHtmlUrls = (
	html: string,
	rewriteUrl: (url: string, attr: string, tag: string, node: unknown) => string,
) => Promise<string>;

export function initProcessContentWithLocalMedia(deps: {
	rewriteHtmlUrls: RewriteHtmlUrls;
}) {
	const { rewriteHtmlUrls } = deps;

	return function processContentWithLocalMedia(params: {
		html: string;
		media: DownloadedMedia[];
	}): Promise<string> {
		const { html, media } = params;

		if (media.length === 0) {
			return Promise.resolve(html);
		}

		const cdnUrlsByOriginal = new Map(media.map((m) => [m.originalUrl, m.cdnUrl]));

		let imgSrcCdnUrl: string | undefined;
		let imgSrcNode: unknown;

		return rewriteHtmlUrls(html, (url, attr, tag, node) => {
			const cdnUrl = cdnUrlsByOriginal.get(url);

			if (tag === "img" && attr === "src") {
				imgSrcCdnUrl = cdnUrl;
				imgSrcNode = node;
			}

			if (attr === "srcset") {
				const sameElementFallback = node === imgSrcNode ? imgSrcCdnUrl : undefined;
				return cdnUrl || sameElementFallback || url;
			}

			return cdnUrl || url;
		});
	};
}
