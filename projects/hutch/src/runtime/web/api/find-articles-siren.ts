import { READ_TIME_BUCKETS, type ReadTimeBucketId, SAVED_WINDOWS, type SavedWindowId } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchApi } from "@packages/translations/hutch-api";
import { HAND_PICKED_SCOPE } from "../pages/readlist/built-in-readlists";
import type { ReadlistDiscovery } from "../pages/readlist/readlist.url";
import { type CollectionQueryParams, FIND_ARTICLES_PARAM, buildQueryString } from "./collection-query";
import type { SirenAction, SirenField } from "./siren";

const { t } = translator(hutchApi, DEFAULT_LOCALE);

const READ_TIME_TITLE_KEYS = {
	"under-5": "findArticles.time.under5",
	"5-10": "findArticles.time.from5To10",
	"10-20": "findArticles.time.from10To20",
	"20-plus": "findArticles.time.over20",
} as const satisfies Record<ReadTimeBucketId, string>;

const SAVED_WINDOW_TITLE_KEYS = {
	today: "findArticles.saved.today",
	week: "findArticles.saved.week",
	month: "findArticles.saved.month",
	older: "findArticles.saved.older",
} as const satisfies Record<SavedWindowId, string>;

const NO_DISCOVERY: ReadlistDiscovery = { time: [], saved: [] };

interface TitledHref {
	title: string;
	href: string;
}

export interface FindArticlesProperty {
	clear: TitledHref;
	clearSearch?: TitledHref;
	clearFilters?: TitledHref;
	noMatches?: { title: string };
}

function hiddenField(name: string, value: string): SirenField {
	return { name, type: "hidden", value };
}

export function findArticlesAction(queryParams: CollectionQueryParams): SirenAction {
	const discovery = queryParams.findArticles?.discovery ?? NO_DISCOVERY;
	const place: SirenField[] = [
		hiddenField(FIND_ARTICLES_PARAM.name, FIND_ARTICLES_PARAM.value),
		...(queryParams.readlist === undefined || queryParams.readlist === DEFAULT_READLIST_SLUG
			? []
			: queryParams.readlist === HAND_PICKED_SCOPE
				? [hiddenField("scope", "hand-picked")]
				: [hiddenField(queryParams.readlistKey, queryParams.readlist)]),
		...(queryParams.status === undefined ? [] : [hiddenField("status", queryParams.status)]),
		...(queryParams.order === undefined ? [] : [hiddenField("order", queryParams.order)]),
	];
	return {
		name: "find-articles",
		href: "/queue",
		method: "GET",
		fields: [
			...place,
			{
				name: "q",
				type: "search",
				title: t("findArticles.search"),
				...(discovery.q === undefined ? {} : { value: discovery.q }),
			},
			{
				name: "time",
				type: "checkbox",
				title: t("findArticles.readingTime"),
				options: READ_TIME_BUCKETS.map((bucket) => ({
					value: bucket.id,
					title: t(READ_TIME_TITLE_KEYS[bucket.id]),
					selected: discovery.time.includes(bucket.id),
				})),
			},
			{
				name: "saved",
				type: "checkbox",
				title: t("findArticles.savedDate"),
				options: SAVED_WINDOWS.map((window) => ({
					value: window.id,
					title: t(SAVED_WINDOW_TITLE_KEYS[window.id]),
					selected: discovery.saved.includes(window.id),
				})),
			},
		],
	};
}

export function findArticlesProperty(input: {
	queryParams: CollectionQueryParams;
	discovery: ReadlistDiscovery;
	noMatches: boolean;
}): FindArticlesProperty {
	const { discovery } = input;
	const hrefWith = (kept: ReadlistDiscovery) =>
		`/queue${buildQueryString({ ...input.queryParams, findArticles: { discovery: kept }, page: undefined })}`;
	const hasSearch = discovery.q !== undefined;
	const hasFilters = discovery.time.length + discovery.saved.length > 0;
	const clearTitle = !hasFilters
		? t("findArticles.clearSearch")
		: hasSearch
			? t("findArticles.clearAll")
			: t("findArticles.clearFilters");
	return {
		clear: { title: clearTitle, href: hrefWith(NO_DISCOVERY) },
		...(hasSearch ? { clearSearch: { title: t("findArticles.clearSearch"), href: hrefWith({ ...discovery, q: undefined }) } } : {}),
		...(hasFilters ? { clearFilters: { title: t("findArticles.clearFilters"), href: hrefWith({ ...NO_DISCOVERY, q: discovery.q }) } } : {}),
		...(input.noMatches ? { noMatches: { title: t("findArticles.noMatches") } } : {}),
	};
}
