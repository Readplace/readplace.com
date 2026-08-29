import type { ArticleStatus } from "@packages/domain/article";
import type { SortOrder } from "@packages/provider-contracts/article-store";

export interface CollectionQueryParams {
	status?: ArticleStatus;
	order?: SortOrder;
	page?: number;
	url?: string;
}

export function buildQueryString(params: CollectionQueryParams): string {
	const search = new URLSearchParams();
	if (params.status) search.set("status", params.status);
	if (params.order) search.set("order", params.order);
	if (params.page) search.set("page", String(params.page));
	if (params.url) search.set("url", params.url);
	const qs = search.toString();
	return qs ? `?${qs}` : "";
}
