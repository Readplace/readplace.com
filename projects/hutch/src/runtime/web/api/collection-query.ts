import { HAND_PICKED_SCOPE } from "../pages/readlist/built-in-readlists";
import type { ArticleStatus } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";
import type { SortOrder } from "@packages/provider-contracts/article-store";
import { type ReadlistDiscovery, discoveryParams } from "../pages/readlist/readlist.url";

export type ReadlistQueryKey = "queue" | "readlist";

export const FIND_ARTICLES_PARAM = { name: "find", value: "articles" } as const;

export interface CollectionQueryParams {
	readlistKey: ReadlistQueryKey;
	readlist?: ReadlistSlug;
	status?: ArticleStatus;
	order?: SortOrder;
	findArticles?: { discovery: ReadlistDiscovery | undefined };
	page?: number;
	url?: string;
	lookup?: boolean;
}

export function buildQueryString(params: CollectionQueryParams): string {
	const search = new URLSearchParams();
	if (params.readlist === HAND_PICKED_SCOPE) search.set("scope", "hand-picked");
	else if (params.readlist && params.readlist !== DEFAULT_READLIST_SLUG) search.set(params.readlistKey, params.readlist);
	if (params.status) search.set("status", params.status);
	if (params.order) search.set("order", params.order);
	if (params.findArticles) {
		search.set(FIND_ARTICLES_PARAM.name, FIND_ARTICLES_PARAM.value);
		for (const [key, value] of discoveryParams(params.findArticles.discovery)) search.append(key, value);
	}
	if (params.page) search.set("page", String(params.page));
	if (params.lookup) search.set("lookup", "1");
	if (params.url) search.set("url", params.url);
	const qs = search.toString();
	return qs ? `?${qs}` : "";
}
