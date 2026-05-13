import type { DownloadedMedia } from "./download-media";

export type RewriteHtmlUrls = (
	html: string,
	rewriteUrl: (url: string, attr: string, tag: string) => string,
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

		return rewriteHtmlUrls(html, (url, attr, tag) => {
			const cdnUrl = cdnUrlsByOriginal.get(url);

			if (tag === "img" && attr === "src") {
				imgSrcCdnUrl = cdnUrl;
			}

			if (attr === "srcset") {
				return cdnUrl || imgSrcCdnUrl || url;
			}

			return cdnUrl || url;
		});
	};
}
