import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IconName } from "@packages/ui-icons";
import { NAV_HIDE_SCRIPT } from "../../shared/reader-nav-script";
import { OnboardingChecklist, ONBOARDING_STYLES } from "../../onboarding/onboarding.component";
import type { Platform } from "../../onboarding/onboarding.types";
import type { DeviceClass } from "@packages/web-analytics";
import {
	render,
	withInternalTracking,
	CONFIRM_POPOVER_STYLES,
	SUBSCRIBE_CTA_LABEL,
} from "@packages/web-shell";
import type { CspNonce, LocalTime, PageBody } from "@packages/web-shell";

import { QUEUE_STYLES } from "./queue.styles";
import { renderQueueCountsTrigger, renderStatusToast } from "./queue-mutation-fragments";
import { renderQueueCard, toQueueCardDisplayModel } from "./queue-card/queue-card.component";
import { renderDeleteConfirm } from "./queue-card/delete-confirm.component";
import { buildQueueFilters, renderQueueFilters } from "./queue-filters.component";
import { buildQueueNav, renderQueueNav } from "./queue-nav.component";
import { QUEUES, queueTitle } from "./queue.nav";
import { SAVE_SURFACES_SHORT_PHRASE } from "../../shared/client-surface-phrases";
import { SAVE_TIP_SCRIPT, type SaveTip } from "../../shared/save-tip/save-tip.component";
import type { SaveTipState } from "../../shared/save-tip/save-tip";
import type { QueueViewModel, SubscriptionBannerState } from "./queue.viewmodel";
import { buildQueueUrl } from "./queue.url";
import { tabQuery, type TabId } from "./queue.tabs";

const QUEUE_TEMPLATE = readFileSync(join(__dirname, "queue.template.html"), "utf-8");

interface QueueDisplayModel {
	saveError?: string;
	saveErrorCode?: string;
	importFlash?: string;
	statusToastHtml: string;
	hasImportSkipped: boolean;
	importSkippedEntries: ReadonlyArray<{ url: string; reasonLabel: string }>;
	importSkippedAndMore?: number;
	isEmpty: boolean;
	emptyTitle: string;
	saveSurfacesShort: string;
	hasArticles: boolean;
	onboardingHtml: string;
	articleHtmls: string[];
	/** The confirmation panels are built from the same `vm.articles` array as the
	 * cards, so the popover set and the trigger set can never disagree. They live
	 * at page level rather than in the card because a pending card replaces its
	 * own subtree every 3s and would rip an open confirmation out mid-decision. */
	deleteConfirmsHtml: string;
	mainClass: string;
	queueNavHtml: string;
	queueTitle: string;
	filtersHtml: string;
	sortUrl: string;
	sortLabel: string;
	sortIconName: IconName;
	showPagination: boolean;
	hasPrev: boolean;
	hasNext: boolean;
	prevUrl?: string;
	nextUrl?: string;
	currentPage: number;
	countsSpanHtml: string;
	subscriptionBannerStateClass: string;
	subscriptionBannerIsTrialCountdown: boolean;
	subscriptionBannerIsCancellationScheduled: boolean;
	subscriptionBannerIsInactive: boolean;
	subscribeCtaLabel: string;
	trialDaysLeft?: number;
	trialDaysLeftWord?: string;
	cancellationEffectiveAt?: LocalTime;
	accessIsReadOnly: boolean;
	saveFormClass: string;
	saveTipState: SaveTipState;
	saveTipHtml: string;
}

const EMPTY_STATE_TITLES: Record<TabId, string> = {
	queue: "There are no more articles to read",
	done: "Your queue is empty",
};

export function emptyStateTitle(tab: TabId): string {
	return EMPTY_STATE_TITLES[tab];
}

function toQueueDisplayModel(vm: QueueViewModel, options: { installed: boolean; savedArticle: boolean; platform: Platform; hasInstallableClient: boolean; onboardingDismissed: boolean; deviceClass: DeviceClass; queuesFeature: boolean; saveTip: SaveTip }): QueueDisplayModel {
	const activeTab = vm.filters.tab;
	const effectiveOrder = vm.filters.order ?? tabQuery(activeTab).defaultOrder;
	const nextOrder = effectiveOrder === "desc" ? "asc" : "desc";
	const sort: { label: string; iconName: IconName } =
		effectiveOrder === "desc"
			? { label: "Newest first", iconName: "arrow-down" }
			: { label: "Oldest first", iconName: "arrow-up" };
	const sortUrl = withInternalTracking(buildQueueUrl({ tab: activeTab, order: nextOrder }), {
		source: "queue-sort",
		content: "sort",
	});

	const onboardingHtml = OnboardingChecklist(
		options.hasInstallableClient
			? {
				hasInstallableClient: true,
				installed: options.installed,
				savedArticle: options.savedArticle,
				platform: options.platform,
			}
			: { hasInstallableClient: false },
		{ dismissed: options.onboardingDismissed },
	);

	const banner: SubscriptionBannerState = vm.subscriptionBanner;
	return {
		saveError: vm.errors?.[0]?.message,
		saveErrorCode: vm.saveErrorCode,
		importFlash: vm.importFlash,
		statusToastHtml: vm.statusFlash ? renderStatusToast(vm.statusFlash) : "",
		hasImportSkipped: Boolean(vm.importSkipped && vm.importSkipped.entries.length > 0),
		importSkippedEntries: vm.importSkipped?.entries ?? [],
		importSkippedAndMore: vm.importSkipped?.andMore,
		isEmpty: vm.isEmpty,
		emptyTitle: emptyStateTitle(activeTab),
		saveSurfacesShort: SAVE_SURFACES_SHORT_PHRASE,
		hasArticles: !vm.isEmpty,
		onboardingHtml,
		articleHtmls: vm.articles.map((article, index) =>
			renderQueueCard(
				toQueueCardDisplayModel(article, {
					isFirst: index === 0,
					deviceClass: options.deviceClass,
				}),
			),
		),
		deleteConfirmsHtml: vm.articles
			.map((article) =>
				renderDeleteConfirm({ confirm: article.deleteConfirm, title: article.title }),
			)
			.join("\n"),
		mainClass: options.queuesFeature ? "queue queue--queues" : "queue",
		queueNavHtml: options.queuesFeature ? renderQueueNav(buildQueueNav({ queues: QUEUES })) : "",
		queueTitle: queueTitle(vm.filters.queue),
		filtersHtml: renderQueueFilters(
			buildQueueFilters({ activeTab, order: vm.filters.order }),
		),
		countsSpanHtml: renderQueueCountsTrigger({ countsUrl: vm.countsUrl }),
		sortUrl,
		sortLabel: sort.label,
		sortIconName: sort.iconName,
		showPagination: Boolean(vm.paginationUrls.prev || vm.paginationUrls.next),
		hasPrev: Boolean(vm.paginationUrls.prev),
		hasNext: Boolean(vm.paginationUrls.next),
		prevUrl: vm.paginationUrls.prev
			? withInternalTracking(vm.paginationUrls.prev, { source: "queue-pagination", content: "prev" })
			: undefined,
		nextUrl: vm.paginationUrls.next
			? withInternalTracking(vm.paginationUrls.next, { source: "queue-pagination", content: "next" })
			: undefined,
		currentPage: vm.currentPage,
		subscriptionBannerStateClass: `queue-banner--${banner.state}`,
		subscriptionBannerIsTrialCountdown: banner.state === "trial-countdown",
		subscriptionBannerIsCancellationScheduled: banner.state === "cancellation-scheduled",
		subscriptionBannerIsInactive: banner.state === "inactive",
		subscribeCtaLabel: SUBSCRIBE_CTA_LABEL,
		trialDaysLeft: banner.state === "trial-countdown" ? banner.daysLeft : undefined,
		trialDaysLeftWord: banner.state === "trial-countdown" ? banner.daysLeftWord : undefined,
		cancellationEffectiveAt: banner.state === "cancellation-scheduled" ? banner.cancellationEffectiveAt : undefined,
		accessIsReadOnly: vm.accessIsReadOnly,
		saveFormClass: vm.accessIsReadOnly ? "queue__save-form queue__save-form--disabled" : "queue__save-form",
		saveTipState: options.saveTip.state,
		saveTipHtml: options.saveTip.html,
	};
}

const autoSubmitScript = (cspNonce: CspNonce) => `
<script nonce="${cspNonce}">
	(function () {
		function run() {
			var form = document.querySelector('[data-auto-submit]');
			if (form) form.requestSubmit();
		}
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', run, { once: true });
		} else {
			run();
		}
	})();
</script>
`;

export function QueuePage(vm: QueueViewModel, options: { cspNonce: CspNonce; deviceClass: DeviceClass; queuesFeature: boolean; saveTip: SaveTip; saveUrl?: string; installed?: boolean; savedArticle?: boolean; platform?: Platform; hasInstallableClient?: boolean; onboardingDismissed?: boolean; statusCode?: number }): PageBody {
	const saveUrl = options.saveUrl;
	const displayModel = toQueueDisplayModel(vm, { installed: options.installed ?? false, savedArticle: options.savedArticle ?? false, platform: options.platform ?? "other", hasInstallableClient: options.hasInstallableClient ?? false, onboardingDismissed: options.onboardingDismissed ?? false, deviceClass: options.deviceClass, queuesFeature: options.queuesFeature, saveTip: options.saveTip });
	const content = render(QUEUE_TEMPLATE, { ...displayModel, saveUrl });

	const scriptParts: string[] = [NAV_HIDE_SCRIPT, SAVE_TIP_SCRIPT];
	if (saveUrl) scriptParts.push(autoSubmitScript(options.cspNonce));

	return {
		seo: {
			title: `${queueTitle(vm.filters.queue)} — Readplace`,
			description: "Your saved articles reading queue.",
			canonicalUrl: "/queue",
			robots: "noindex, nofollow",
		},
		styles: `${QUEUE_STYLES}\n${ONBOARDING_STYLES}\n${CONFIRM_POPOVER_STYLES}`,
		bodyClass: "page-queue",
		content: { html: content },
		scripts: scriptParts.join("\n"),
		statusCode: options.statusCode,
	};
}
