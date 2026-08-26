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
import { DEFAULT_QUEUE, type Queue } from "./queue.nav";
import {
	queueDeleteConfirmPopoverId,
	renderQueueDeleteConfirm,
} from "./queue-delete-confirm.component";
import { SAVE_SURFACES_SHORT_PHRASE } from "../../shared/client-surface-phrases";
import { SAVE_TIP_SCRIPT, type SaveTip } from "../../shared/save-tip/save-tip.component";
import type { SaveTipState } from "../../shared/save-tip/save-tip";
import type { QueueSurface } from "./queue.app-surface";
import type { QueueViewModel, SubscriptionBannerState } from "./queue.viewmodel";
import {
	type LinkParams,
	QUEUE_DISMISS_ONBOARDING_PATH,
	QUEUE_SAVE_PATH,
	buildQueueUrl,
	queueDeletePath,
	queueReturnQuery,
} from "./queue.url";
import { tabQuery, type TabId } from "./queue.tabs";

export interface QueueRailViewModel {
	queues: readonly Queue[];
	activeQueue: Queue;
	linkParams: LinkParams;
	newQueueAction: string;
	canCreate: boolean;
	errorFlash?: string;
}

const QUEUE_TEMPLATE = readFileSync(join(__dirname, "queue.template.html"), "utf-8");

interface QueueDisplayModel {
	backLink?: { href: string; label: string };
	showInstallHint: boolean;
	subscriptionBannerShowsCta: boolean;
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
	queueDeleteConfirmHtml: string;
	mainClass: string;
	queueNavHtml: string;
	queueErrorFlash?: string;
	queueTitle: string;
	saveAction: string;
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
	saveBarHidden: boolean;
	defaultQueueUrl: string;
	defaultQueueLabel: string;
	saveTipState: SaveTipState;
	saveTipHtml: string;
}

const EMPTY_STATE_TITLES: Record<TabId, string> = {
	queue: "There are no more articles to read",
	done: "Nothing read yet",
};

const NOTHING_SAVED_TITLE = "Nothing saved yet";

export function emptyStateTitle(input: { tab: TabId; queueHoldsArticles: boolean }): string {
	return input.queueHoldsArticles ? EMPTY_STATE_TITLES[input.tab] : NOTHING_SAVED_TITLE;
}

function queueDeleteConfirmPanel(rail: QueueRailViewModel | undefined): string {
	if (!rail?.canCreate) return "";
	const active = rail.activeQueue;
	if (active.slug === DEFAULT_QUEUE.slug) return "";
	return renderQueueDeleteConfirm({
		popoverId: queueDeleteConfirmPopoverId(active.slug),
		url: `${queueDeletePath(active.slug)}${queueReturnQuery({}, rail.linkParams)}`,
		label: active.label,
	});
}

function toQueueDisplayModel(vm: QueueViewModel, options: { queueHoldsArticles: boolean; installed: boolean; savedArticle: boolean; savedCount: number; platform: Platform; hasInstallableClient: boolean; onboardingDismissed: boolean; onboardingCompletedBefore: boolean; onboardingCompletionUnearned: boolean; deviceClass: DeviceClass; rail?: QueueRailViewModel; saveTip: SaveTip; surface?: QueueSurface; linkParams: LinkParams }): QueueDisplayModel {
	const activeTab = vm.filters.tab;
	const linkParams = options.linkParams;
	const saveBarHidden = vm.filters.queue !== DEFAULT_QUEUE.slug;
	const effectiveOrder = vm.filters.order ?? tabQuery(activeTab).defaultOrder;
	const nextOrder = effectiveOrder === "desc" ? "asc" : "desc";
	const sort: { label: string; iconName: IconName } =
		effectiveOrder === "desc"
			? { label: "Newest first", iconName: "arrow-down" }
			: { label: "Oldest first", iconName: "arrow-up" };
	const sortUrl = withInternalTracking(
		buildQueueUrl({ queue: vm.filters.queue, tab: activeTab, order: nextOrder }, linkParams),
		{
			source: "queue-sort",
			content: "sort",
		},
	);

	const onboardingHtml = options.surface
		? ""
		: OnboardingChecklist(
			options.hasInstallableClient
				? {
					hasInstallableClient: true,
					installed: options.installed,
					savedArticle: options.savedArticle,
					savedCount: options.savedCount,
					platform: options.platform,
				}
				: { hasInstallableClient: false },
			{
				dismissed: options.onboardingDismissed,
				completedBefore: options.onboardingCompletedBefore,
				completionUnearned: options.onboardingCompletionUnearned,
				dismissAction: `${QUEUE_DISMISS_ONBOARDING_PATH}${queueReturnQuery(vm.filters, linkParams)}`,
			},
		);

	const banner: SubscriptionBannerState = vm.subscriptionBanner;
	return {
		backLink: options.surface?.backLink,
		showInstallHint: options.surface === undefined,
		subscriptionBannerShowsCta: vm.purchaseCtaAllowed,
		saveError: vm.errors?.[0]?.message,
		saveErrorCode: vm.saveErrorCode,
		importFlash: vm.importFlash,
		statusToastHtml: vm.statusFlash ? renderStatusToast(vm.statusFlash) : "",
		hasImportSkipped: Boolean(vm.importSkipped && vm.importSkipped.entries.length > 0),
		importSkippedEntries: vm.importSkipped?.entries ?? [],
		importSkippedAndMore: vm.importSkipped?.andMore,
		isEmpty: vm.isEmpty,
		emptyTitle: emptyStateTitle({ tab: activeTab, queueHoldsArticles: options.queueHoldsArticles }),
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
		queueDeleteConfirmHtml: queueDeleteConfirmPanel(options.rail),
		mainClass: options.rail ? "queue queue--queues" : "queue",
		queueNavHtml: options.rail
			? renderQueueNav(
					buildQueueNav({
						queues: options.rail.queues,
						activeSlug: options.rail.activeQueue.slug,
						linkParams: options.rail.linkParams,
						newQueueAction: options.rail.newQueueAction,
						canCreate: options.rail.canCreate,
							}),
				)
			: "",
		queueErrorFlash: options.rail?.errorFlash,
		queueTitle: options.rail?.activeQueue.label ?? DEFAULT_QUEUE.label,
		saveAction: withInternalTracking(
			`${QUEUE_SAVE_PATH}${queueReturnQuery({ ...vm.filters, queue: DEFAULT_QUEUE.slug }, linkParams)}`,
			{ source: "queue", content: "save" },
		),
		filtersHtml: renderQueueFilters(
			buildQueueFilters({
				activeTab,
				order: vm.filters.order,
				queue: vm.filters.queue,
				linkParams,
			}),
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
		saveFormClass: [
			"queue__save-form",
			saveBarHidden ? "queue__save-form--hidden" : "queue__save-form--visible",
			...(vm.accessIsReadOnly ? ["queue__save-form--disabled"] : []),
		].join(" "),
		saveBarHidden,
		defaultQueueUrl: buildQueueUrl({}, linkParams),
		defaultQueueLabel: DEFAULT_QUEUE.label,
		saveTipState: options.saveTip.state,
		saveTipHtml: options.saveTip.html,
	};
}

const QUEUE_RENAME_SCRIPT =
	'<script src="/client-dist/queue-rename.client.js" defer></script>';

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

export function QueuePage(vm: QueueViewModel, options: { cspNonce: CspNonce; deviceClass: DeviceClass; queueHoldsArticles: boolean; rail?: QueueRailViewModel; saveTip: SaveTip; saveUrl?: string; installed?: boolean; savedArticle?: boolean; savedCount?: number; platform?: Platform; hasInstallableClient?: boolean; onboardingDismissed?: boolean; onboardingCompletedBefore?: boolean; onboardingCompletionUnearned?: boolean; statusCode?: number; surface?: QueueSurface; linkParams?: LinkParams }): PageBody {
	const saveUrl = options.saveUrl;
	const displayModel = toQueueDisplayModel(vm, { queueHoldsArticles: options.queueHoldsArticles, installed: options.installed ?? false, savedArticle: options.savedArticle ?? false, savedCount: options.savedCount ?? 0, platform: options.platform ?? "other", hasInstallableClient: options.hasInstallableClient ?? false, onboardingDismissed: options.onboardingDismissed ?? false, onboardingCompletedBefore: options.onboardingCompletedBefore ?? false, onboardingCompletionUnearned: options.onboardingCompletionUnearned ?? false, deviceClass: options.deviceClass, rail: options.rail, saveTip: options.saveTip, surface: options.surface, linkParams: options.linkParams ?? [] });
	const content = render(QUEUE_TEMPLATE, { ...displayModel, saveUrl });

	const scriptParts: string[] = [NAV_HIDE_SCRIPT, SAVE_TIP_SCRIPT];
	if (options.rail) scriptParts.push(QUEUE_RENAME_SCRIPT);
	if (saveUrl) scriptParts.push(autoSubmitScript(options.cspNonce));

	return {
		seo: {
			title: `${displayModel.queueTitle} — Readplace`,
			description: "Your saved articles reading queue.",
			canonicalUrl: "/queue",
			robots: "noindex, nofollow",
		},
		styles: `${QUEUE_STYLES}\n${ONBOARDING_STYLES}\n${CONFIRM_POPOVER_STYLES}`,
		bodyClass: options.surface ? "page-queue page-queue--chromeless" : "page-queue",
		content: { html: content },
		scripts: scriptParts.join("\n"),
		statusCode: options.statusCode,
	};
}
