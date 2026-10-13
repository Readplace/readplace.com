import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READ_TIME_BUCKETS, SAVED_WINDOWS } from "@packages/domain/article";
import { render, renderInFlightDots, withInternalTracking } from "@packages/web-shell";

import { preferencesFeatureParams } from "./readlist-preferences-feature";
import {
	READLIST_PATH,
	buildReadlistFiltersUrl,
	buildReadlistUrl,
	type ReadlistDiscovery,
	type ReadlistUrlState,
} from "./readlist.url";

const ROW_TEMPLATE = readFileSync(join(__dirname, "readlist-discovery.template.html"), "utf-8");
const FILTERS_TEMPLATE = readFileSync(join(__dirname, "readlist-filters.template.html"), "utf-8");
const DRAWER_TEMPLATE = readFileSync(join(__dirname, "readlist-filters-drawer.template.html"), "utf-8");

const FILTERS_POPOVER_ID = "readlist-filters";

const PARSE_ORIGIN = "https://internal.invalid";

const APPLY_LOADER_HTML = renderInFlightDots("readlist-filters__apply-loader in-flight-dots");

const NO_DISCOVERY: ReadlistDiscovery = { time: [], saved: [] };

const ROW_STATE_CLASSES = {
	visible: "readlist-discovery--visible",
	hidden: "readlist-discovery--hidden",
} as const;

const FILTER_STATE_CLASSES = {
	active: "readlist-discovery__filter--active",
	idle: "readlist-discovery__filter--idle",
} as const;

const FILTERS_SCOPES = {
	popover: { idPrefix: FILTERS_POPOVER_ID, closeControls: [{ popoverId: FILTERS_POPOVER_ID }] },
	fallback: { idPrefix: `${FILTERS_POPOVER_ID}-fallback`, closeControls: [] },
} as const;

type FiltersScope = keyof typeof FILTERS_SCOPES;

interface HiddenField {
	name: string;
	value: string;
}

interface DiscoveryOption {
	value: string;
	label: string;
	checked: boolean;
}

interface DiscoveryGroup {
	legend: string;
	name: string;
	options: DiscoveryOption[];
}

export interface ReadlistDiscoveryDisplayModel {
	stateClass: string;
	action: string;
	searchFields: HiddenField[];
	query: string | undefined;
	filterLabel: string;
	filterStateClass: string;
	groups: DiscoveryGroup[];
	applyAction: string;
	clearAllAction: string;
}

export function tickedFacetCount(discovery: ReadlistDiscovery): number {
	return discovery.time.length + discovery.saved.length;
}

function hiddenFieldsOf(href: string): HiddenField[] {
	return Array.from(new URL(href, PARSE_ORIGIN).searchParams, ([name, value]) => ({ name, value }));
}

export function buildReadlistDiscovery(input: {
	filters: ReadlistUrlState;
	tabHoldsRows: boolean;
	preferencesEnabled: boolean;
}): ReadlistDiscoveryDisplayModel {
	const discovery = input.filters.discovery ?? NO_DISCOVERY;
	const place = { readlist: input.filters.readlist, tab: input.filters.tab, order: input.filters.order };
	const featureParams = preferencesFeatureParams(input.preferencesEnabled);
	const searchUrl = buildReadlistUrl({ ...place, discovery: { ...discovery, q: undefined } }, featureParams);
	const filtersUrl = buildReadlistFiltersUrl({ ...place, discovery: { ...NO_DISCOVERY, q: discovery.q } }, featureParams);
	const ticked = tickedFacetCount(discovery);
	return {
		stateClass: input.tabHoldsRows ? ROW_STATE_CLASSES.visible : ROW_STATE_CLASSES.hidden,
		action: READLIST_PATH,
		searchFields: hiddenFieldsOf(withInternalTracking(searchUrl, { source: "queue-search", content: "search" })),
		query: discovery.q,
		filterLabel: ticked === 0 ? "Filters" : `Filters (${ticked})`,
		filterStateClass: ticked === 0 ? FILTER_STATE_CLASSES.idle : FILTER_STATE_CLASSES.active,
		groups: [
			{
				legend: "Reading time",
				name: "time",
				options: READ_TIME_BUCKETS.map((bucket) => ({
					value: bucket.id,
					label: bucket.label,
					checked: discovery.time.includes(bucket.id),
				})),
			},
			{
				legend: "Saved date",
				name: "saved",
				options: SAVED_WINDOWS.map((window) => ({
					value: window.id,
					label: window.label,
					checked: discovery.saved.includes(window.id),
				})),
			},
		],
		applyAction: withInternalTracking(filtersUrl, { source: "queue-filter-drawer", content: "apply" }),
		clearAllAction: withInternalTracking(filtersUrl, { source: "queue-filter-drawer", content: "clear-all" }),
	};
}

function renderReadlistFilters(model: ReadlistDiscoveryDisplayModel, scope: FiltersScope): string {
	return render(FILTERS_TEMPLATE, {
		...model,
		...FILTERS_SCOPES[scope],
		scope,
		applyLoaderHtml: APPLY_LOADER_HTML,
	});
}

export function renderReadlistDiscovery(model: ReadlistDiscoveryDisplayModel): string {
	return render(ROW_TEMPLATE, {
		...model,
		popoverId: FILTERS_POPOVER_ID,
		fallbackFormHtml: renderReadlistFilters(model, "fallback"),
	});
}

export function renderReadlistFiltersDrawer(model: ReadlistDiscoveryDisplayModel): string {
	return render(DRAWER_TEMPLATE, {
		popoverId: FILTERS_POPOVER_ID,
		formHtml: renderReadlistFilters(model, "popover"),
	});
}
