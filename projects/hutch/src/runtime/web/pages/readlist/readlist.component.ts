import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IconName } from "@packages/ui-icons";
import { CONFIRM_POPOVER_STYLES, render, withInternalTracking } from "@packages/web-shell";
import type { CspNonce, PageBody } from "@packages/web-shell";
import type { DeviceClass } from "@packages/web-analytics";

import { NAV_HIDE_SCRIPT } from "../../shared/reader-nav-script";
import { SAVE_SURFACES_SHORT_PHRASE } from "../../shared/client-surface-phrases";
import { renderIllustration } from "../../shared/illustrations/illustrations";
import {
	ONBOARDING_STYLES,
	OnboardingChecklist,
} from "../../onboarding/onboarding.component";
import type { OnboardingContext } from "../../onboarding/onboarding.types";
import { SAVE_TIP_SCRIPT, type SaveTip } from "../../shared/save-tip/save-tip.component";
import type { SaveTipState } from "../../shared/save-tip/save-tip";
import {
	SUBSCRIBE_PLANS_STYLES,
	renderSubscribePlansPopover,
} from "../../shared/subscribe-plans/subscribe-plans.component";
import { renderMarkStatusConfirm } from "./mark-status-confirm.component";
import { renderDeleteConfirm } from "./readlist-card/delete-confirm.component";
import {
	readlistDeleteConfirmPopoverId,
	renderReadlistDeleteConfirm,
} from "./readlist-delete-confirm.component";
import { renderReadlistCountsTrigger, renderStatusToast } from "./readlist-mutation-fragments";
import { readlistPreferencesEnabled } from "./readlist-preferences-feature";
import {
	renderReadlistSaveSkeleton,
	toReadlistSaveSkeletonDisplayModel,
} from "./readlist-save-skeleton.component";
import { READER_PAGE_SCRIPTS, renderReaderSkeleton } from "./reader-skeleton/reader-skeleton.component";
import type { ReadlistRailViewModel } from "./readlist-rail";
import { DEFAULT_READLIST } from "./readlist.nav";
import { type TabId, tabQuery } from "./readlist.tabs";
import {
	READLIST_SAVE_PATH,
	buildReadlistUrl,
	readlistDeletePath,
	readlistReturnQuery,
} from "./readlist.url";
import type { ReadlistViewModel } from "./readlist.viewmodel";
import { renderReadlistAlert } from "./readlist-alert.component";
import { readlistAlertFor } from "./readlist-alerts";
import { renderReadlistCard, toReadlistCardDisplayModel } from "./readlist-card/readlist-card.component";
import { savedArticlesLabel, showingLabel } from "./readlist-counts.component";
import { buildReadlistNav, renderReadlistNav } from "./readlist-nav.component";
import {
	buildReadlistTabs,
	renderReadlistTabs,
} from "./readlist-tabs.component";
import {
	READLIST_RENAME_SCRIPT,
	renderReadlistRename,
} from "./readlist-rename.component";
import {
	renderReadlistSubscription,
	toReadlistSubscriptionDisplayModel,
} from "./readlist-subscription.component";
import { READLIST_STYLES } from "./readlist.styles";

const TEMPLATE = readFileSync(join(__dirname, "readlist.template.html"), "utf-8");

export const READLIST_BODY_CLASS = "page-readlist";

export const READLIST_PAGE_SCRIPTS = [
	NAV_HIDE_SCRIPT,
	SAVE_TIP_SCRIPT,
	READLIST_RENAME_SCRIPT,
	READER_PAGE_SCRIPTS,
].join("\n");

interface ReadlistOnboarding {
	context: OnboardingContext;
	dismissed: boolean;
	completedBefore: boolean;
	completionUnearned: boolean;
}

export interface ReadlistPageOptions {
	cspNonce: CspNonce;
	deviceClass: DeviceClass;
	readlistHoldsArticles: boolean;
	knownUnreadCount?: number;
	rail: ReadlistRailViewModel;
	saveTip: SaveTip;
	saveUrl?: string;
	onboarding: ReadlistOnboarding;
	query: Record<string, unknown>;
}

interface EmptyAction {
	key: string;
	href: string;
	label: string;
}

interface EmptyState {
	title: string;
	text: string;
	actions: EmptyAction[];
}

const NOTHING_SAVED: Omit<EmptyState, "actions"> = {
	title: "Nothing saved yet",
	text: `Save your first article by pasting a link above, or set up one-tap saving from ${SAVE_SURFACES_SHORT_PHRASE}.`,
};

const CAUGHT_UP: Omit<EmptyState, "actions"> = {
	title: "You're all caught up",
	text: "There are no articles left in your To Read list. Save something new to keep your reading list going.",
};

const NOTHING_READ: Omit<EmptyState, "actions"> = {
	title: "No finished articles yet",
	text: "Once you finish an article and mark it as read, you'll find it here.",
};

const CUSTOM_READLIST_EMPTY: Omit<EmptyState, "actions"> = {
	title: "No articles in this readlist yet",
	text: `Every link you save lands in ${DEFAULT_READLIST.label}. Open an article there to add it to this readlist.`,
};

function emptyState(input: {
	tab: TabId;
	readlistHoldsArticles: boolean;
	isDefaultReadlist: boolean;
	unreadUrl: string;
	defaultReadlistUrl: string;
}): EmptyState {
	const install: EmptyAction = {
		key: "install",
		href: withInternalTracking("/install", { source: "queue-empty", content: "install" }),
		label: "Set up one-tap saving",
	};
	const openDefault: EmptyAction = {
		key: "open-default",
		href: input.defaultReadlistUrl,
		label: `Go to ${DEFAULT_READLIST.label}`,
	};
	const keepSaving = input.isDefaultReadlist ? install : openDefault;
	if (!input.readlistHoldsArticles) {
		return input.isDefaultReadlist
			? { ...NOTHING_SAVED, actions: [install] }
			: { ...CUSTOM_READLIST_EMPTY, actions: [openDefault] };
	}
	return input.tab === "queue"
		? { ...CAUGHT_UP, actions: [keepSaving] }
		: {
				...NOTHING_READ,
				actions: [
					{ key: "view-unread", href: input.unreadUrl, label: "View Unread Articles" },
					keepSaving,
				],
			};
}

export function readlistPanels(rail: ReadlistRailViewModel): {
	deleteConfirms: string;
	renames: string;
} {
	if (!rail.canCreate) return { deleteConfirms: "", renames: "" };
	const owned = rail.readlists.filter((readlist) => readlist.slug !== DEFAULT_READLIST.slug);
	const returnQuery = readlistReturnQuery({ readlist: rail.activeReadlist.slug });
	return {
		deleteConfirms: owned
			.map((readlist) =>
				renderReadlistDeleteConfirm({
					popoverId: readlistDeleteConfirmPopoverId(readlist.slug),
					url: `${readlistDeletePath(readlist.slug)}${returnQuery}`,
					label: readlist.label,
					destinations: owned.filter((other) => other.slug !== readlist.slug),
					illustrationHtml: renderIllustration("trash-can"),
				}),
			)
			.join("\n"),
		renames: owned
			.map((readlist) => renderReadlistRename({ slug: readlist.slug, label: readlist.label }))
			.join("\n"),
	};
}

function countLabelBeforeCounts(vm: ReadlistViewModel): string {
	const totalIsKnown = vm.currentPage === 1 && !vm.paginationUrls.next;
	return totalIsKnown ? savedArticlesLabel(vm.articles.length) : "Saved Articles";
}

export function ReadlistPage(vm: ReadlistViewModel, options: ReadlistPageOptions): PageBody {
	const { articles, filters } = vm;
	const isDefaultReadlist = filters.readlist === DEFAULT_READLIST.slug;
	const effectiveOrder = filters.order ?? tabQuery(filters.tab).defaultOrder;
	const nextOrder = effectiveOrder === "desc" ? "asc" : "desc";
	const sort: { label: string; iconName: IconName } =
		effectiveOrder === "desc"
			? { label: "Newest first", iconName: "arrow-down" }
			: { label: "Oldest first", iconName: "arrow-up" };
	const defaultReadlistUrl = buildReadlistUrl({});
	const alert = readlistAlertFor(options.query);
	const banner = vm.subscriptionBanner;
	const panels = readlistPanels(options.rail);
	const empty = emptyState({
		tab: filters.tab,
		readlistHoldsArticles: options.readlistHoldsArticles,
		isDefaultReadlist,
		unreadUrl: withInternalTracking(
			buildReadlistUrl({ readlist: filters.readlist, tab: "queue" }),
			{ source: "queue-empty", content: "view-unread" },
		),
		defaultReadlistUrl: withInternalTracking(defaultReadlistUrl, {
			source: "queue-empty",
			content: "open-default",
		}),
	});
	const saveTipState: SaveTipState = options.saveTip.state;

	const content = render(TEMPLATE, {
		readlistNavHtml: renderReadlistNav(
			buildReadlistNav({
				readlists: options.rail.readlists,
				activeSlug: options.rail.activeReadlist.slug,
				newReadlistAction: options.rail.newReadlistAction,
				canCreate: options.rail.canCreate,
			}),
		),
		alertHtml: renderReadlistAlert(alert),
		statusToastHtml: vm.statusFlash
			? renderStatusToast(vm.statusFlash)
			: "",
		saveCardClass: isDefaultReadlist ? "readlist-save--visible" : "readlist-save--hidden",
		saveFormStateClass: vm.accessIsReadOnly
			? "readlist-save__form--disabled"
			: "readlist-save__form--enabled",
		saveInputStateClass: vm.saveErrorCode || vm.errors?.length
			? "readlist-save__input--invalid"
			: "readlist-save__input--valid",
		saveAction: withInternalTracking(
			`${READLIST_SAVE_PATH}${readlistReturnQuery({ ...filters, readlist: DEFAULT_READLIST.slug })}`,
			{ source: "queue", content: "save" },
		),
		saveUrl: options.saveUrl,
		saveTipState,
		accessIsReadOnly: vm.accessIsReadOnly,
		saveError: vm.errors?.[0]?.message,
		saveErrorCode: vm.saveErrorCode,
		importFlash: vm.importFlash,
		hasImportSkipped: Boolean(vm.importSkipped && vm.importSkipped.entries.length > 0),
		importSkippedEntries: vm.importSkipped?.entries ?? [],
		importSkippedAndMore: vm.importSkipped?.andMore,
		tabsHtml: renderReadlistTabs(
			buildReadlistTabs({
				activeTab: filters.tab,
				readlist: filters.readlist,
				order: filters.order,
				knownUnreadCount: options.knownUnreadCount,
				preferencesEnabled: readlistPreferencesEnabled(options.query),
			}),
		),
		countsSpanHtml: renderReadlistCountsTrigger({ countsUrl: vm.countsUrl }),
		countLabel: countLabelBeforeCounts(vm),
		sortUrl: withInternalTracking(
			buildReadlistUrl({ readlist: filters.readlist, tab: filters.tab, order: nextOrder }),
			{ source: "queue-sort", content: "sort", term: nextOrder },
		),
		sortLabel: sort.label,
		sortIconName: sort.iconName,
		saveSkeletonHtml: renderReadlistSaveSkeleton(
			toReadlistSaveSkeletonDisplayModel({ filters, accessIsReadOnly: vm.accessIsReadOnly }),
		),
		isEmpty: vm.isEmpty,
		emptyIllustrationHtml: renderIllustration("book-lightbulb"),
		emptyTitle: empty.title,
		emptyText: empty.text,
		emptyActions: empty.actions,
		hasArticles: !vm.isEmpty,
		articleHtmls: articles.map((article, index) =>
			renderReadlistCard(
				toReadlistCardDisplayModel(article, { isFirst: index === 0, deviceClass: options.deviceClass }),
			),
		),
		paginationStateClass: vm.isEmpty
			? "readlist-pagination--hidden"
			: "readlist-pagination--visible",
		showingLabel: showingLabel({ rowsOnPage: vm.articles.length }),
		prevUrl: vm.paginationUrls.prev
			? withInternalTracking(vm.paginationUrls.prev, {
					source: "queue-pagination",
					content: "prev",
				})
			: undefined,
		nextUrl: vm.paginationUrls.next
			? withInternalTracking(vm.paginationUrls.next, {
					source: "queue-pagination",
					content: "next",
				})
			: undefined,
		currentPage: vm.currentPage,
		subscriptionHtml: renderReadlistSubscription(toReadlistSubscriptionDisplayModel(banner)),
		onboardingHtml: OnboardingChecklist(options.onboarding.context, {
			dismissed: options.onboarding.dismissed,
			completedBefore: options.onboarding.completedBefore,
			completionUnearned: options.onboarding.completionUnearned,
			returnQuery: readlistReturnQuery(filters),
		}),
		readlistRenamesHtml: panels.renames,
		readlistDeleteConfirmHtml: panels.deleteConfirms,
		deleteConfirmsHtml: articles
			.flatMap((article) =>
				article.deleteConfirm === undefined
					? []
					: [
							renderDeleteConfirm({
								confirm: article.deleteConfirm,
								title: article.title,
								illustrationHtml: renderIllustration("trash-can"),
							}),
						],
			)
			.join("\n"),
		markStatusConfirmsHtml: articles
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
		subscribePlansHtml:
			banner.state === "trial-countdown" || banner.state === "inactive"
				? renderSubscribePlansPopover({ source: "queue-banner" })
				: "",
		saveTipHtml: options.saveTip.html,
		readerSkeletonHtml: renderReaderSkeleton({ cspNonce: options.cspNonce }),
	});

	const scripts = [READLIST_PAGE_SCRIPTS];
	if (options.saveUrl) scripts.push(autoSubmitScript(options.cspNonce));

	return {
		seo: {
			title: `${options.rail.activeReadlist.label} — Readplace`,
			description: "Your saved articles readlist.",
			canonicalUrl: "/queue",
			robots: "noindex, nofollow",
		},
		styles: `${CONFIRM_POPOVER_STYLES}\n${SUBSCRIBE_PLANS_STYLES}\n${ONBOARDING_STYLES}\n${READLIST_STYLES}`,
		bodyClass: READLIST_BODY_CLASS,
		content: { html: content },
		scripts: scripts.join("\n"),
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
