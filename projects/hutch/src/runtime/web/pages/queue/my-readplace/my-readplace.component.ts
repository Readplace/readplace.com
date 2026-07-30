import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeviceClass } from "@packages/web-analytics";
import { render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { NAV_HIDE_SCRIPT } from "../../../shared/reader-nav-script";
import { QUEUE_STYLES } from "../queue.styles";
import { MY_READPLACE_STYLES } from "./my-readplace.styles";
import { buildQueueFilters, renderQueueFilters } from "../queue-filters.component";
import type { QueueTabLink } from "../queue-tab";
import { renderPlaceholderCards } from "./my-readplace.placeholders";
import {
	MAX_READING_PREFERENCE_LENGTH,
	type MyReadplaceMode,
	type MyReadplaceViewModel,
} from "./my-readplace.viewmodel";
import {
	MY_READPLACE_FEATURE,
	MY_READPLACE_TAB_ID,
	buildMyReadplaceCountsUrl,
	buildMyReadplaceSaveUrl,
	buildMyReadplaceUrl,
} from "./my-readplace.url";

const TEMPLATE = readFileSync(join(__dirname, "my-readplace.template.html"), "utf-8");

export function myReadplaceTabLink(): QueueTabLink {
	return {
		id: MY_READPLACE_TAB_ID,
		href: withInternalTracking(buildMyReadplaceUrl(), {
			source: "queue-filters",
			content: "filter-my",
		}),
		label: "My Readplace",
		badgeLabel: "New",
	};
}

interface MyReadplaceDisplayModel {
	mode: MyReadplaceMode;
	text: string;
	invalid: boolean;
	showForm: boolean;
	showCancel: boolean;
	showSummary: boolean;
	maxLength: number;
	saveUrl: string;
	editUrl: string;
	cancelUrl: string;
	countsUrl: string;
	filtersHtml: string;
	cardHtmls: string[];
}

function toMyReadplaceDisplayModel(
	vm: MyReadplaceViewModel,
	options: { deviceClass: DeviceClass; now: Date },
): MyReadplaceDisplayModel {
	const showSummary = vm.mode === "summary";
	return {
		mode: vm.mode,
		text: vm.text,
		invalid: vm.invalid,
		showForm: !showSummary,
		showCancel: vm.mode === "edit",
		showSummary,
		maxLength: MAX_READING_PREFERENCE_LENGTH,
		saveUrl: buildMyReadplaceSaveUrl(),
		editUrl: buildMyReadplaceUrl({ edit: true }),
		cancelUrl: buildMyReadplaceUrl(),
		countsUrl: buildMyReadplaceCountsUrl(),
		filtersHtml: renderQueueFilters(
			buildQueueFilters({
				activeTab: MY_READPLACE_TAB_ID,
				feature: MY_READPLACE_FEATURE,
				extraTabs: [myReadplaceTabLink()],
			}),
		),
		cardHtmls: showSummary
			? renderPlaceholderCards({ now: options.now, deviceClass: options.deviceClass })
			: [],
	};
}

export function MyReadplacePage(
	vm: MyReadplaceViewModel,
	options: { deviceClass: DeviceClass; now: Date },
): PageBody {
	return {
		seo: {
			title: "My Readplace — Readplace",
			description: "Articles picked from your saved reading interests.",
			canonicalUrl: "/queue",
			robots: "noindex, nofollow",
		},
		styles: `${QUEUE_STYLES}\n${MY_READPLACE_STYLES}`,
		bodyClass: "page-queue",
		content: { html: render(TEMPLATE, toMyReadplaceDisplayModel(vm, options)) },
		scripts: NAV_HIDE_SCRIPT,
	};
}
