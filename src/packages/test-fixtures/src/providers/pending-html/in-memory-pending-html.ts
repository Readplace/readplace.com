import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { PutPendingHtml } from "@packages/provider-contracts/pending-html";

export interface InMemoryPendingHtml {
	putPendingHtml: PutPendingHtml;
	readPendingHtml: (url: string) => string | undefined;
}

export function initInMemoryPendingHtml(): InMemoryPendingHtml {
	const store = new Map<string, string>();

	const putPendingHtml: PutPendingHtml = async (params) => {
		const key = ArticleResourceUniqueId.parse(params.url).toS3PendingHtmlKey();
		store.set(key, params.html);
	};

	const readPendingHtml = (url: string): string | undefined => {
		const key = ArticleResourceUniqueId.parse(url).toS3PendingHtmlKey();
		return store.get(key);
	};

	return { putPendingHtml, readPendingHtml };
}
