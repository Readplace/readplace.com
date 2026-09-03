import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IconName } from "@packages/ui-icons";
import { NAV_HIDE_SCRIPT } from "../../shared/reader-nav-script";
import { OnboardingChecklist, ONBOARDING_STYLES } from "../../onboarding/onboarding.component";
import type { PitchablePlatform } from "../../onboarding/extension-install";
import type { DeviceClass } from "@packages/web-analytics";
import {
	render,
	withInternalTracking,
	CONFIRM_POPOVER_STYLES,
	SUBSCRIBE_CTA_LABEL,
} from "@packages/web-shell";
import type { CspNonce, LocalTime, PageBody } from "@packages/web-shell";

import { READLIST_STYLES } from "./readlist.styles";
import { renderReadlistCountsTrigger, renderStatusToast } from "./readlist-mutation-fragments";
import { renderReadlistCard, toReadlistCardDisplayModel } from "./readlist-card/readlist-card.component";
import { renderDeleteConfirm } from "./readlist-card/delete-confirm.component";
import { renderMarkStatusConfirm } from "./mark-status-confirm.component";
import { buildReadlistFilters, renderReadlistFilters } from "./readlist-filters.component";
import { buildReadlistNav, renderReadlistNav } from "./readlist-nav.component";
import { DEFAULT_READLIST, type Readlist } from "./readlist.nav";
import {
	readlistDeleteConfirmPopoverId,
	renderReadlistDeleteConfirm,
} from "./readlist-delete-confirm.component";
import {
	SUBSCRIBE_PLANS_POPOVER_ID,
	SUBSCRIBE_PLANS_STYLES,
	renderSubscribePlansPopover,
} from "../../shared/subscribe-plans/subscribe-plans.component";
import { SAVE_SURFACES_SHORT_PHRASE } from "../../shared/client-surface-phrases";
import { SAVE_TIP_SCRIPT, type SaveTip } from "../../shared/save-tip/save-tip.component";
import type { SaveTipState } from "../../shared/save-tip/save-tip";
import type { ReadlistViewModel, SubscriptionBannerState } from "./readlist.viewmodel";
import {
	READLIST_DISMISS_ONBOARDING_PATH,
	READLIST_SAVE_PATH,
	buildReadlistUrl,
	readlistDeletePath,
	readlistReturnQuery,
} from "./readlist.url";
import { tabQuery, type TabId } from "./readlist.tabs";

export interface ReadlistRailViewModel {
	readlists: readonly Readlist[];
	activeReadlist: Readlist;
	newReadlistAction: string;
	canCreate: boolean;
	errorFlash?: string;
}

const READLIST_TEMPLATE = readFileSync(join(__dirname, "readlist.template.html"), "utf-8");

interface ReadlistDisplayModel {
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
	markStatusConfirmsHtml: string;
	readlistDeleteConfirmHtml: string;
	readlistNavHtml: string;
	readlistErrorFlash?: string;
	readlistTitle: string;
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
	subscribePlansPopoverId: string;
	subscribePlansHtml: string;
	trialDaysLeft?: number;
	trialDaysLeftWord?: string;
	cancellationEffectiveAt?: LocalTime;
	accessIsReadOnly: boolean;
	saveFormClass: string;
	saveBarHidden: boolean;
	defaultReadlistUrl: string;
	defaultReadlistLabel: string;
	saveTipState: SaveTipState;
	saveTipHtml: string;
}

const EMPTY_STATE_TITLES: Record<TabId, string> = {
	queue: "There are no more articles to read",
	done: "Nothing read yet",
};

const NOTHING_SAVED_TITLE = "Nothing saved yet";

export function emptyStateTitle(input: { tab: TabId; readlistHoldsArticles: boolean }): string {
	return input.readlistHoldsArticles ? EMPTY_STATE_TITLES[input.tab] : NOTHING_SAVED_TITLE;
}

function readlistDeleteConfirmPanels(rail: ReadlistRailViewModel): string {
	if (!rail.canCreate) return "";
	const owned = rail.readlists.filter((readlist) => readlist.slug !== DEFAULT_READLIST.slug);
	const returnQuery = readlistReturnQuery({ readlist: rail.activeReadlist.slug });
	return owned
		.map((readlist) =>
			renderReadlistDeleteConfirm({
				popoverId: readlistDeleteConfirmPopoverId(readlist.slug),
				url: `${readlistDeletePath(readlist.slug)}${returnQuery}`,
				label: readlist.label,
				destinations: owned.filter((other) => other.slug !== readlist.slug),
			}),
		)
		.join("\n");
}

function toReadlistDisplayModel(vm: ReadlistViewModel, options: { readlistHoldsArticles: boolean; knownUnreadCount?: number; installed: boolean; savedArticle: boolean; savedCount: number; platform: PitchablePlatform; hasInstallableClient: boolean; onboardingDismissed: boolean; onboardingCompletedBefore: boolean; onboardingCompletionUnearned: boolean; deviceClass: DeviceClass; rail: ReadlistRailViewModel; saveTip: SaveTip }): ReadlistDisplayModel {
	const activeTab = vm.filters.tab;
	const saveBarHidden = vm.filters.readlist !== DEFAULT_READLIST.slug;
	const effectiveOrder = vm.filters.order ?? tabQuery(activeTab).defaultOrder;
	const nextOrder = effectiveOrder === "desc" ? "asc" : "desc";
	const sort: { label: string; iconName: IconName } =
		effectiveOrder === "desc"
			? { label: "Newest first", iconName: "arrow-down" }
			: { label: "Oldest first", iconName: "arrow-up" };
	const sortUrl = withInternalTracking(
		buildReadlistUrl({ readlist: vm.filters.readlist, tab: activeTab, order: nextOrder }),
		{
			source: "queue-sort",
			content: "sort",
			term: nextOrder,
		},
	);

	const onboardingHtml = OnboardingChecklist(
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
			dismissAction: `${READLIST_DISMISS_ONBOARDING_PATH}${readlistReturnQuery(vm.filters)}`,
		},
	);

	const banner: SubscriptionBannerState = vm.subscriptionBanner;
	const bannerIsTrialCountdown = banner.state === "trial-countdown";
	const bannerIsInactive = banner.state === "inactive";
	return {
		saveError: vm.errors?.[0]?.message,
		saveErrorCode: vm.saveErrorCode,
		importFlash: vm.importFlash,
		statusToastHtml: vm.statusFlash ? renderStatusToast(vm.statusFlash) : "",
		hasImportSkipped: Boolean(vm.importSkipped && vm.importSkipped.entries.length > 0),
		importSkippedEntries: vm.importSkipped?.entries ?? [],
		importSkippedAndMore: vm.importSkipped?.andMore,
		isEmpty: vm.isEmpty,
		emptyTitle: emptyStateTitle({ tab: activeTab, readlistHoldsArticles: options.readlistHoldsArticles }),
		saveSurfacesShort: SAVE_SURFACES_SHORT_PHRASE,
		hasArticles: !vm.isEmpty,
		onboardingHtml,
		articleHtmls: vm.articles.map((article, index) =>
			renderReadlistCard(
				toReadlistCardDisplayModel(article, {
					isFirst: index === 0,
					deviceClass: options.deviceClass,
				}),
			),
		),
		deleteConfirmsHtml: vm.articles
			.flatMap((article) =>
				article.deleteConfirm === undefined
					? []
					: [renderDeleteConfirm({ confirm: article.deleteConfirm, title: article.title })],
			)
			.join("\n"),
		markStatusConfirmsHtml: vm.articles
			.flatMap((article) =>
				article.markStatusConfirm === undefined
					? []
					: [
							renderMarkStatusConfirm({
								confirm: article.markStatusConfirm,
								source: "queue-card",
								lead: article.title,
							}),
						],
			)
			.join("\n"),
		readlistDeleteConfirmHtml: readlistDeleteConfirmPanels(options.rail),
		readlistNavHtml: renderReadlistNav(
			buildReadlistNav({
				readlists: options.rail.readlists,
				activeSlug: options.rail.activeReadlist.slug,
				newReadlistAction: options.rail.newReadlistAction,
				canCreate: options.rail.canCreate,
			}),
		),
		readlistErrorFlash: options.rail.errorFlash,
		readlistTitle: options.rail.activeReadlist.label,
		saveAction: withInternalTracking(
			`${READLIST_SAVE_PATH}${readlistReturnQuery({ ...vm.filters, readlist: DEFAULT_READLIST.slug })}`,
			{ source: "queue", content: "save" },
		),
		filtersHtml: renderReadlistFilters(
			buildReadlistFilters({
				activeTab,
				order: vm.filters.order,
				readlist: vm.filters.readlist,
				knownUnreadCount: options.knownUnreadCount,
			}),
		),
		countsSpanHtml: renderReadlistCountsTrigger({ countsUrl: vm.countsUrl }),
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
		subscriptionBannerStateClass: `readlist-banner--${banner.state}`,
		subscriptionBannerIsTrialCountdown: bannerIsTrialCountdown,
		subscriptionBannerIsCancellationScheduled: banner.state === "cancellation-scheduled",
		subscriptionBannerIsInactive: bannerIsInactive,
		subscribeCtaLabel: SUBSCRIBE_CTA_LABEL,
		subscribePlansPopoverId: SUBSCRIBE_PLANS_POPOVER_ID,
		subscribePlansHtml:
			bannerIsTrialCountdown || bannerIsInactive
				? renderSubscribePlansPopover({ source: "queue-banner" })
				: "",
		trialDaysLeft: bannerIsTrialCountdown ? banner.daysLeft : undefined,
		trialDaysLeftWord: bannerIsTrialCountdown ? banner.daysLeftWord : undefined,
		cancellationEffectiveAt: banner.state === "cancellation-scheduled" ? banner.cancellationEffectiveAt : undefined,
		accessIsReadOnly: vm.accessIsReadOnly,
		saveFormClass: [
			"readlist__save-form",
			saveBarHidden ? "readlist__save-form--hidden" : "readlist__save-form--visible",
			...(vm.accessIsReadOnly ? ["readlist__save-form--disabled"] : []),
		].join(" "),
		saveBarHidden,
		defaultReadlistUrl: buildReadlistUrl({}),
		defaultReadlistLabel: DEFAULT_READLIST.label,
		saveTipState: options.saveTip.state,
		saveTipHtml: options.saveTip.html,
	};
}

const READLIST_RENAME_SCRIPT =
	'<script src="/client-dist/readlist-rename.client.js" defer></script>';

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

export function ReadlistPage(vm: ReadlistViewModel, options: { cspNonce: CspNonce; deviceClass: DeviceClass; readlistHoldsArticles: boolean; knownUnreadCount?: number; rail: ReadlistRailViewModel; saveTip: SaveTip; saveUrl?: string; installed?: boolean; savedArticle?: boolean; savedCount?: number; platform?: PitchablePlatform; hasInstallableClient?: boolean; onboardingDismissed?: boolean; onboardingCompletedBefore?: boolean; onboardingCompletionUnearned?: boolean; statusCode?: number }): PageBody {
	const saveUrl = options.saveUrl;
	const displayModel = toReadlistDisplayModel(vm, { readlistHoldsArticles: options.readlistHoldsArticles, knownUnreadCount: options.knownUnreadCount, installed: options.installed ?? false, savedArticle: options.savedArticle ?? false, savedCount: options.savedCount ?? 0, platform: options.platform ?? "other", hasInstallableClient: options.hasInstallableClient ?? false, onboardingDismissed: options.onboardingDismissed ?? false, onboardingCompletedBefore: options.onboardingCompletedBefore ?? false, onboardingCompletionUnearned: options.onboardingCompletionUnearned ?? false, deviceClass: options.deviceClass, rail: options.rail, saveTip: options.saveTip });
	const content = render(READLIST_TEMPLATE, { ...displayModel, saveUrl });

	const scriptParts: string[] = [NAV_HIDE_SCRIPT, SAVE_TIP_SCRIPT, READLIST_RENAME_SCRIPT];
	if (saveUrl) scriptParts.push(autoSubmitScript(options.cspNonce));

	return {
		seo: {
			title: `${displayModel.readlistTitle} — Readplace`,
			description: "Your saved articles readlist.",
			canonicalUrl: "/queue",
			robots: "noindex, nofollow",
		},
		styles: `${READLIST_STYLES}\n${ONBOARDING_STYLES}\n${CONFIRM_POPOVER_STYLES}\n${SUBSCRIBE_PLANS_STYLES}`,
		bodyClass: "page-readlist",
		content: { html: content },
		scripts: scriptParts.join("\n"),
		statusCode: options.statusCode,
	};
}
