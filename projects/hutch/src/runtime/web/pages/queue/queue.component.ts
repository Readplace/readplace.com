import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OnboardingChecklist, ONBOARDING_STYLES } from "../../onboarding/onboarding.component";
import type { BrowserName } from "../../onboarding/onboarding.types";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { QUEUE_STYLES } from "./queue.styles";
import { renderQueueCard, toQueueCardDisplayModel } from "./queue-card/queue-card.component";
import type { QueueViewModel, SubscriptionBannerState } from "./queue.viewmodel";
import { buildQueueUrl } from "./queue.url";
import { tabQuery } from "./queue.tabs";

const QUEUE_TEMPLATE = readFileSync(join(__dirname, "queue.template.html"), "utf-8");

interface QueueDisplayModel {
	saveError?: string;
	saveErrorCode?: string;
	importFlash?: string;
	hasImportSkipped: boolean;
	importSkippedEntries: ReadonlyArray<{ url: string; reasonLabel: string }>;
	importSkippedAndMore?: number;
	isEmpty: boolean;
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
	subscriptionBannerIsInactive: boolean;
	trialDaysLeft?: number;
	trialDaysLeftWord?: string;
	accessIsReadOnly: boolean;
	saveFormClass: string;
}

function filterLinkClass(isActive: boolean): string {
	return `queue__filter-link${isActive ? " queue__filter-link--active" : ""}`;
}

export function formatUnreadLabel(count: number): string {
	return count > 99 ? "To read (99+)" : `To read (${count})`;
}

function toQueueDisplayModel(vm: QueueViewModel, options: { extensionInstalled: boolean; extensionSavedArticle: boolean; browser: BrowserName; onboardingDismissed: boolean }): QueueDisplayModel {
	const activeTab = vm.filters.tab;
	const effectiveOrder = vm.filters.order ?? tabQuery(activeTab).defaultOrder;
	const nextOrder = effectiveOrder === "desc" ? "asc" : "desc";
	const sortLabel = effectiveOrder === "desc" ? "Newest first ↓" : "Oldest first ↑";
	const sortUrl = buildQueueUrl({ tab: activeTab, order: nextOrder });

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
		hasImportSkipped: Boolean(vm.importSkipped && vm.importSkipped.entries.length > 0),
		importSkippedEntries: vm.importSkipped?.entries ?? [],
		importSkippedAndMore: vm.importSkipped?.andMore,
		isEmpty: vm.isEmpty,
		hasArticles: !vm.isEmpty,
		onboardingHtml,
		articleHtmls: vm.articles.map((article, index) =>
			renderQueueCard(toQueueCardDisplayModel(article, { isFirst: index === 0 })),
		),
		filterUnreadClass: filterLinkClass(activeTab === "queue"),
		filterUnreadLabel: formatUnreadLabel(vm.unreadCount),
		filterReadClass: filterLinkClass(activeTab === "done"),
		filterUnreadUrl: vm.filterUrls.unread,
		filterReadUrl: vm.filterUrls.read,
		sortUrl,
		sortLabel,
		showPagination: vm.totalPages > 1,
		hasPrev: Boolean(vm.paginationUrls.prev),
		hasNext: Boolean(vm.paginationUrls.next),
		prevUrl: vm.paginationUrls.prev,
		nextUrl: vm.paginationUrls.next,
		currentPage: vm.currentPage,
		totalPages: vm.totalPages,
		subscriptionBannerStateClass: `queue-banner--${banner.state}`,
		subscriptionBannerIsTrialCountdown: banner.state === "trial-countdown",
		subscriptionBannerIsInactive: banner.state === "inactive",
		trialDaysLeft: banner.state === "trial-countdown" ? banner.daysLeft : undefined,
		trialDaysLeftWord: banner.state === "trial-countdown" ? banner.daysLeftWord : undefined,
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

export function QueuePage(vm: QueueViewModel, options?: { saveUrl?: string; extensionInstalled?: boolean; extensionSavedArticle?: boolean; browser?: BrowserName; onboardingDismissed?: boolean; statusCode?: number }): PageBody {
	const saveUrl = options?.saveUrl;
	const displayModel = toQueueDisplayModel(vm, { extensionInstalled: options?.extensionInstalled ?? false, extensionSavedArticle: options?.extensionSavedArticle ?? false, browser: options?.browser ?? "other", onboardingDismissed: options?.onboardingDismissed ?? false });
	const content = render(QUEUE_TEMPLATE, { ...displayModel, saveUrl });

	const scriptParts: string[] = [];
	if (saveUrl) scriptParts.push(AUTO_SUBMIT_SCRIPT);

	return {
		seo: {
			title: "My Queue — Readplace",
			description: "Your saved articles reading queue.",
			canonicalUrl: "/queue",
			robots: "noindex, nofollow",
		},
		styles: `${QUEUE_STYLES}\n${ONBOARDING_STYLES}`,
		bodyClass: "page-queue",
		content: { html: content },
		scripts: scriptParts.join("\n"),
		statusCode: options?.statusCode,
	};
}
