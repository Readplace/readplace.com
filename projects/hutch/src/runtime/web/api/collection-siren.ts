import type {
	FindArticlesResult,
	SortOrder,
} from "@packages/test-fixtures/providers/article-store";
import type { ArticleStatus } from "@packages/domain/article";
import type { SirenEntity, SirenLink } from "./siren";
import { toArticleSubEntity } from "./article-siren";

interface CollectionQueryParams {
	status?: ArticleStatus;
	order?: SortOrder;
	page?: number;
	pageSize?: number;
	url?: string;
}

export interface CollectionWarning {
	readonly code: string;
	readonly message: string;
}

function buildQueryString(params: CollectionQueryParams): string {
	const search = new URLSearchParams();
	if (params.status) search.set("status", params.status);
	if (params.order) search.set("order", params.order);
	if (params.page) search.set("page", String(params.page));
	if (params.pageSize) search.set("pageSize", String(params.pageSize));
	if (params.url) search.set("url", params.url);
	const qs = search.toString();
	return qs ? `?${qs}` : "";
}

export function toArticleCollectionEntity(
	result: FindArticlesResult,
	queryParams: CollectionQueryParams,
	options?: { warning?: CollectionWarning },
): SirenEntity {
	const { articles, total, page, pageSize } = result;
	const totalPages = Math.ceil(total / pageSize);

	const links: SirenLink[] = [
		{ rel: ["self"], href: `/queue${buildQueryString(queryParams)}` },
		{ rel: ["root"], href: "/queue" },
	];

	if (page > 1) {
		links.push({
			rel: ["prev"],
			href: `/queue${buildQueryString({ ...queryParams, page: page - 1 })}`,
		});
	}

	if (page < totalPages) {
		links.push({
			rel: ["next"],
			href: `/queue${buildQueryString({ ...queryParams, page: page + 1 })}`,
		});
	}

	const properties: Record<string, unknown> = { total, page, pageSize };
	if (options?.warning) properties.warning = options.warning;

	return {
		class: ["collection", "articles"],
		properties,
		entities: articles.map(toArticleSubEntity),
		links,
		actions: [
			{
				name: "save-article",
				href: "/queue",
				method: "POST",
				type: "application/json",
				fields: [{ name: "url", type: "url" }],
			},
			{
				name: "save-html",
				href: "/queue/save-html",
				method: "POST",
				type: "application/json",
				fields: [
					{ name: "url", type: "url" },
					{ name: "rawHtml", type: "text" },
					{ name: "title", type: "text" },
				],
			},
			{
				name: "search",
				href: "/queue",
				method: "GET",
				fields: [
					{ name: "status", type: "text" },
					{ name: "order", type: "text" },
					{ name: "page", type: "number" },
					{ name: "pageSize", type: "number" },
					{ name: "url", type: "url" },
				],
			},
		],
	};
}
