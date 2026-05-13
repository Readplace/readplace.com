import posthtml from "posthtml";
import urls from "@11ty/posthtml-urls";
import type { HutchLogger } from "@packages/hutch-logger";
import { initDownloadMedia, type DownloadMedia } from "../../save-link/download-media";
import { initProcessContentWithLocalMedia } from "../../save-link/process-content-with-local-media";
import type { ProcessContent } from "../../save-link/save-link-work";
import type { ParserDepBundle } from "./parser";
import type { ArticleStoreDepBundle } from "./article-store";

export type MediaDepBundle = {
	downloadMedia: DownloadMedia;
	processContent: ProcessContent;
};

export function initMediaDepBundle(deps: {
	parser: ParserDepBundle;
	articleStore: ArticleStoreDepBundle;
	logger: HutchLogger;
	imagesCdnBaseUrl: string;
}): MediaDepBundle {
	const downloadMedia = initDownloadMedia({
		putImageObject: deps.articleStore.putImageObject,
		logger: deps.logger,
		crawlFetch: deps.parser.crawlFetch,
		imagesCdnBaseUrl: deps.imagesCdnBaseUrl,
	});
	const processContent = initProcessContentWithLocalMedia({
		rewriteHtmlUrls: (html, rewriteUrl) => {
			const plugin = urls({ eachURL: rewriteUrl });
			return posthtml().use(plugin).process(html).then((result) => result.html);
		},
	});
	return { downloadMedia, processContent };
}
