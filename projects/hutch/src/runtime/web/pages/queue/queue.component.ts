import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OnboardingChecklist, ONBOARDING_STYLES } from "../../onboarding/onboarding.component";
import type { BrowserName } from "../../onboarding/onboarding.types";
import { render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { QUEUE_STYLES } from "./queue.styles";
import { renderQueueCard, toQueueCardDisplayModel } from "./queue-card/queue-card.component";
import { renderToast } from "../../shared/toast/toast.component";
import { OFFER_POPUP_SCRIPT, renderOfferPopup } from "../../shared/offer-popup/offer-popup.component";
import { OFFER_POPUP_STYLES } from "../../shared/offer-popup/offer-popup.styles";
import type { QueueViewModel, SubscriptionBannerState } from "./queue.viewmodel";
import { buildQueueUrl } from "./queue.url";
import { tabQuery, type TabId } from "./queue.tabs";

const QUEUE_TEMPLATE = readFileSync(join(__dirname, "queue.template.html"), "utf-8");

/** Long enough to read the message and reach for Undo, short enough not to
 * linger; the global toast.client script removes it after this delay. */
const STATUS_TOAST_DISMISS_MS = 6000;

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
	hasArticles: boolean;
	onboardingHtml: string;
	articleHtmls: string[];
	filterUnreadClass: string;
	filterUnreadLabel: string;
	filterReadClass: string;
	filterUnreadUrl: string;
	filterReadUrl: string;
	sortUrl: string;
	sortLabel: string;
	showPagination: boolean;
	hasPrev: boolean;
	hasNext: boolean;
	prevUrl?: string;
	nextUrl?: string;
	currentPage: number;
	totalPages: number;
	subscriptionBannerStateClass: string;
	subscriptionBannerIsTrialCountdown: boolean;
	subscriptionBannerIsCancellationScheduled: boolean;
	subscriptionBannerIsInactive: boolean;
	trialDaysLeft?: number;
	trialDaysLeftWord?: string;
	cancellationEffectiveAt?: string;
	accessIsReadOnly: boolean;
	saveFormClass: string;
}

function filterLinkClass(isActive: boolean): string {
	return `queue__filter-link${isActive ? " queue__filter-link--active" : ""}`;
}

export function formatUnreadLabel(count: number): string {
	return count > 99 ? "To Read (99+)" : `To Read (${count})`;
}

const EMPTY_STATE_TITLES: Record<TabId, string> = {
	queue: "There are no more articles to read",
	done: "Your queue is empty",
};

export function emptyStateTitle(tab: TabId): string {
	return EMPTY_STATE_TITLES[tab];
}

function toQueueDisplayModel(vm: QueueViewModel, options: { extensionInstalled: boolean; extensionSavedArticle: boolean; browser: BrowserName; onboardingDismissed: boolean }): QueueDisplayModel {
	const activeTab = vm.filters.tab;
	const effectiveOrder = vm.filters.order ?? tabQuery(activeTab).defaultOrder;
	const nextOrder = effectiveOrder === "desc" ? "asc" : "desc";
	const sortLabel = effectiveOrder === "desc" ? "Newest first ↓" : "Oldest first ↑";
	const sortUrl = withInternalTracking(buildQueueUrl({ tab: activeTab, order: nextOrder }), {
		source: "queue-sort",
		content: "sort",
	});

	const onboardingHtml = options.onboardingDismissed
		? ""
		: OnboardingChecklist({
			extensionInstalled: options.extensionInstalled,
			extensionSavedArticle: options.extensionSavedArticle,
			browser: options.browser,
		});

	const banner: SubscriptionBannerState = vm.subscriptionBanner;
	return {
		saveError: vm.errors?.[0]?.message,
		saveErrorCode: vm.saveErrorCode,
		importFlash: vm.importFlash,
		statusToastHtml: vm.statusFlash
			? renderToast({
				message: vm.statusFlash.message,
				dismissMs: STATUS_TOAST_DISMISS_MS,
				actions: [
					{
						method: "POST",
						url: withInternalTracking(vm.statusFlash.undoUrl, { source: "queue-toast", content: "undo" }),
						label: "Undo",
						fields: [{ name: "status", value: vm.statusFlash.undoStatus }],
					},
				],
			})
			: "",
		hasImportSkipped: Boolean(vm.importSkipped && vm.importSkipped.entries.length > 0),
		importSkippedEntries: vm.importSkipped?.entries ?? [],
		importSkippedAndMore: vm.importSkipped?.andMore,
		isEmpty: vm.isEmpty,
		emptyTitle: emptyStateTitle(activeTab),
		hasArticles: !vm.isEmpty,
		onboardingHtml,
		articleHtmls: vm.articles.map((article, index) =>
			renderQueueCard(toQueueCardDisplayModel(article, { isFirst: index === 0 })),
		),
		filterUnreadClass: filterLinkClass(activeTab === "queue"),
		filterUnreadLabel: formatUnreadLabel(vm.unreadCount),
		filterReadClass: filterLinkClass(activeTab === "done"),
		filterUnreadUrl: withInternalTracking(vm.filterUrls.unread, { source: "queue-filters", content: "filter-unread" }),
		filterReadUrl: withInternalTracking(vm.filterUrls.read, { source: "queue-filters", content: "filter-read" }),
		sortUrl,
		sortLabel,
		showPagination: vm.totalPages > 1,
		hasPrev: Boolean(vm.paginationUrls.prev),
		hasNext: Boolean(vm.paginationUrls.next),
		prevUrl: vm.paginationUrls.prev
			? withInternalTracking(vm.paginationUrls.prev, { source: "queue-pagination", content: "prev" })
			: undefined,
		nextUrl: vm.paginationUrls.next
			? withInternalTracking(vm.paginationUrls.next, { source: "queue-pagination", content: "next" })
			: undefined,
		currentPage: vm.currentPage,
		totalPages: vm.totalPages,
		subscriptionBannerStateClass: `queue-banner--${banner.state}`,
		subscriptionBannerIsTrialCountdown: banner.state === "trial-countdown",
		subscriptionBannerIsCancellationScheduled: banner.state === "cancellation-scheduled",
		subscriptionBannerIsInactive: banner.state === "inactive",
		trialDaysLeft: banner.state === "trial-countdown" ? banner.daysLeft : undefined,
		trialDaysLeftWord: banner.state === "trial-countdown" ? banner.daysLeftWord : undefined,
		cancellationEffectiveAt: banner.state === "cancellation-scheduled" ? banner.cancellationEffectiveAt : undefined,
		accessIsReadOnly: vm.accessIsReadOnly,
		saveFormClass: vm.accessIsReadOnly ? "queue__save-form queue__save-form--disabled" : "queue__save-form",
	};
}

const AUTO_SUBMIT_SCRIPT = `
<script>
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

export function QueuePage(vm: QueueViewModel, options: { offerPaymentLink: string; saveUrl?: string; extensionInstalled?: boolean; extensionSavedArticle?: boolean; browser?: BrowserName; onboardingDismissed?: boolean; offerPreview?: boolean; statusCode?: number }): PageBody {
	const saveUrl = options.saveUrl;
	const offerPreview = options.offerPreview ?? false;
	const displayModel = toQueueDisplayModel(vm, { extensionInstalled: options.extensionInstalled ?? false, extensionSavedArticle: options.extensionSavedArticle ?? false, browser: options.browser ?? "other", onboardingDismissed: options.onboardingDismissed ?? false });
	const content = render(QUEUE_TEMPLATE, { ...displayModel, saveUrl, offerPopupHtml: offerPreview ? renderOfferPopup(options.offerPaymentLink) : "" });

	const scriptParts: string[] = [];
	if (offerPreview) scriptParts.push(OFFER_POPUP_SCRIPT);
	if (saveUrl) scriptParts.push(AUTO_SUBMIT_SCRIPT);

	const styles = offerPreview
		? `${QUEUE_STYLES}\n${ONBOARDING_STYLES}\n${OFFER_POPUP_STYLES}`
		: `${QUEUE_STYLES}\n${ONBOARDING_STYLES}`;

	return {
		seo: {
			title: "My Queue — Readplace",
			description: "Your saved articles reading queue.",
			canonicalUrl: "/queue",
			robots: "noindex, nofollow",
		},
		styles,
		bodyClass: "page-queue",
		content: { html: content },
		scripts: scriptParts.join("\n"),
		statusCode: options.statusCode,
	};
}
