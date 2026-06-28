import type {
	FindArticlesResult,
	SortOrder,
} from "@packages/provider-contracts/article-store";
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

	// Older iOS builds resolve the Share-help URL from this rel; the current client
	// holds the path itself and ignores this link, but it stays advertised so those
	// installed builds keep their server-rendered help instead of a bundled fallback.
	// The href is server-internal, so the help page can move without a client release.
	links.push({
		rel: ["add-links-help"],
		title: "How to add links",
		href: "/help/add-links",
	});

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
				title: "Save a link",
				href: "/queue",
				method: "POST",
				type: "application/json",
				fields: [{ name: "url", type: "url" }],
			},
			{
				name: "save-articles",
				href: "/queue/save-articles",
				method: "POST",
				type: "multipart/form-data",
				/** Bulk "Save All Tabs": one captured page per open tab. Siren has
				 * no array field type, so `manifest` carries a JSON-encoded array
				 * of `{ url, title?, mediaType? }` (one per page), and each page
				 * whose entry declares a `mediaType` has its captured bytes in a
				 * sibling `content-<index>` file part. */
				fields: [
					{ name: "manifest", type: "text" },
					{ name: "content", type: "file" },
				],
			},
			{
				name: "save-html",
				title: "Save a page",
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
				name: "save-content",
				title: "Save a file",
				href: "/queue/save-content",
				method: "POST",
				type: "multipart/form-data",
				fields: [
					{ name: "url", type: "url" },
					{ name: "content", type: "file" },
					{ name: "mediaType", type: "text" },
					{ name: "title", type: "text" },
				],
			},
			{
				name: "search",
				title: "Search",
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
