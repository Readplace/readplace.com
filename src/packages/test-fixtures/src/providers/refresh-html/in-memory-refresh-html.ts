import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { PutRefreshHtml, ReadRefreshHtml } from "./refresh-html.types";

export interface InMemoryRefreshHtml {
	putRefreshHtml: PutRefreshHtml;
	readRefreshHtml: ReadRefreshHtml;
}

export function initInMemoryRefreshHtml(): InMemoryRefreshHtml {
	const store = new Map<string, string>();

	const putRefreshHtml: PutRefreshHtml = async (params) => {
		const key = ArticleResourceUniqueId.parse(params.url).toS3RefreshHtmlKey();
		store.set(key, params.html);
	};

	const readRefreshHtml: ReadRefreshHtml = async (url) => {
		const key = ArticleResourceUniqueId.parse(url).toS3RefreshHtmlKey();
		const html = store.get(key);
		if (html === undefined) {
			throw new Error(`No refresh-html staged for URL: ${url}`);
		}
		return html;
	};

	return { putRefreshHtml, readRefreshHtml };
}
