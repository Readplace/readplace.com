import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IconName } from "@packages/ui-icons";
import {
	CONFIRM_POPOVER_STYLES,
	render,
	renderAlert,
	renderIllustration,
	withInternalTracking,
} from "@packages/web-shell";
import type { CspNonce, PageBody } from "@packages/web-shell";
import type { DeviceClass } from "@packages/web-analytics";

import { NAV_HIDE_SCRIPT } from "../../shared/reader-nav-script";
import { OFFLINE_DOWNLOAD_SCRIPT } from "../../shared/offline-reader/offline-download-script";
import { offlineCardOpenScript } from "../../shared/offline-reader/offline-card-open-script";
import { offlineCopyRowScript } from "../../shared/article-body/crawl-bookmark/offline-copy-row-script";
import { SAVE_SURFACES_SHORT_PHRASE } from "../../shared/client-surface-phrases";
import {
	ONBOARDING_STYLES,
	OnboardingChecklist,
} from "../../onboarding/onboarding.component";
import type { OnboardingContext } from "../../onboarding/onboarding.types";
import { buildExtensionInstallUrl, type PitchablePlatform } from "../../onboarding/extension-install";
import { SAVE_TIP_SCRIPT, type SaveTip } from "../../shared/save-tip/save-tip.component";
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
import { renderReadlistSave, toReadlistSaveDisplayModel } from "./readlist-save.component";
import { READER_PAGE_SCRIPTS, renderReaderSkeleton } from "./reader-skeleton/reader-skeleton.component";
import type { ReadlistRailViewModel } from "./readlist-rail";
import { DEFAULT_READLIST } from "./readlist.nav";
import { type TabId, tabQuery } from "./readlist.tabs";
import {
	type ReadlistUrlState,
	buildReadlistUrl,
	readlistDeletePath,
	readlistReturnQuery,
} from "./readlist.url";
import type { ReadlistViewModel } from "./readlist.viewmodel";
import { readlistAlertFor } from "./readlist-alerts";
import { renderReadlistCard, toReadlistCardDisplayModel } from "./readlist-card/readlist-card.component";
import { showingLabel } from "./readlist-counts.component";
import { renderReadlistTabTotal } from "./readlist-tab-total.component";
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

export function readlistPageScripts(cspNonce: CspNonce): string {
	return [
		NAV_HIDE_SCRIPT,
		SAVE_TIP_SCRIPT,
		READLIST_RENAME_SCRIPT,
		READER_PAGE_SCRIPTS,
		OFFLINE_DOWNLOAD_SCRIPT,
		offlineCopyRowScript(cspNonce),
		offlineCardOpenScript(cspNonce),
	].join("\n");
}

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

interface DeviceClient {
	platform: PitchablePlatform;
	installed: boolean;
}

const NOTHING_SAVED_TITLE = "Nothing saved yet";

const EXTENSION_INVITE_TEXT =
	"Save your first article by pasting a link above, or use the Readplace browser extension to save it in one click.";

const NOTHING_SAVED_INVITES: Record<PitchablePlatform, { text: string; label: string }> = {
	chrome: { text: EXTENSION_INVITE_TEXT, label: "Install Chrome extension" },
	firefox: { text: EXTENSION_INVITE_TEXT, label: "Install Firefox extension" },
	iphone: {
		text: "Save your first article by pasting a link above, or use the Readplace iPhone app to save it from the share sheet.",
		label: "Install iPhone app",
	},
	other: {
		text: `Save your first article by pasting a link above, or set up one-tap saving from ${SAVE_SURFACES_SHORT_PHRASE}.`,
		label: "Set up one-tap saving",
	},
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
	text: `Choose an article from ${DEFAULT_READLIST.label} and add it here to start organising this readlist.`,
};

function nothingSaved(client: DeviceClient): EmptyState {
	const invite = NOTHING_SAVED_INVITES[client.platform];
	const install: EmptyAction = {
		key: "install",
		href: withInternalTracking(buildExtensionInstallUrl(client.platform), {
			source: "queue-empty",
			content: "install",
		}),
		label: invite.label,
	};
	return {
		title: NOTHING_SAVED_TITLE,
		text: invite.text,
		actions: client.installed ? [] : [install],
	};
}

function emptyState(input: {
	tab: TabId;
	readlistHoldsArticles: boolean;
	isDefaultReadlist: boolean;
	unreadUrl: string;
	client: DeviceClient;
}): EmptyState {
	if (!input.readlistHoldsArticles) {
		return input.isDefaultReadlist
			? nothingSaved(input.client)
			: { ...CUSTOM_READLIST_EMPTY, actions: [] };
	}
	return input.tab === "queue"
		? { ...CAUGHT_UP, actions: [] }
		: {
				...NOTHING_READ,
				actions: [{ key: "view-unread", href: input.unreadUrl, label: "View Unread Articles" }],
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

function installClientOf(context: OnboardingContext): DeviceClient {
	return context.hasInstallableClient
		? { platform: context.platform, installed: context.installed }
		: { platform: "other", installed: false };
}

interface OfflineDownloadControl {
	href: string;
	stateClass: string;
}

function offlineDownloadControl(input: { filters: ReadlistUrlState; isEmpty: boolean }): OfflineDownloadControl {
	const offered = input.filters.tab === "queue" && !input.isEmpty;
	return {
		href: withInternalTracking(
			buildReadlistUrl({ readlist: input.filters.readlist, tab: "queue", order: input.filters.order }),
			{ source: "queue-listing", content: "download-offline" },
		),
		stateClass: offered ? "readlist-listing__offline--offered" : "readlist-listing__offline--withheld",
	};
}

function firstByteTotal(vm: ReadlistViewModel): number | undefined {
	const totalIsKnown = vm.currentPage === 1 && !vm.paginationUrls.next;
	return totalIsKnown ? vm.articles.length : undefined;
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
		client: installClientOf(options.onboarding.context),
	});

	const content = render(TEMPLATE, {
		readlistNavHtml: renderReadlistNav(
			buildReadlistNav({
				readlists: options.rail.readlists,
				activeSlug: options.rail.activeReadlist.slug,
				newReadlistAction: options.rail.newReadlistAction,
				canCreate: options.rail.canCreate,
			}),
		),
		alertHtml: renderAlert({ key: "readlist", content: alert }),
		starterExplanationHtml: renderAlert({
			key: "starter-picks",
			content:
				options.rail.activeReadlist.starterCampaignId === undefined
					? undefined
					: {
							variant: "info",
							title: { text: "Your Hacker News picks", element: "p" },
							message: {
								text: "Readplace added these ten picks once to All and this readlist. Read, file, or delete them as you like. New links you save here go to All.",
							},
						},
		}),
		statusToastHtml: vm.statusFlash
			? renderStatusToast(vm.statusFlash)
			: "",
		saveCardHtml: renderReadlistSave(
			toReadlistSaveDisplayModel({
				filters,
				accessIsReadOnly: vm.accessIsReadOnly,
				saveTipState: options.saveTip.state,
				errors: vm.errors,
				saveErrorCode: vm.saveErrorCode,
				importFlash: vm.importFlash,
				importSkipped: vm.importSkipped,
				saveUrl: options.saveUrl,
			}),
		),
		tabsHtml: renderReadlistTabs(
			buildReadlistTabs({
				activeTab: filters.tab,
				readlist: filters.readlist,
				order: filters.order,
				preferencesEnabled: readlistPreferencesEnabled(options.query),
			}),
		),
		countsSpanHtml: renderReadlistCountsTrigger({ countsUrl: vm.countsUrl }),
		countHtml: renderReadlistTabTotal({ total: firstByteTotal(vm) }),
		sortUrl: withInternalTracking(
			buildReadlistUrl({ readlist: filters.readlist, tab: filters.tab, order: nextOrder }),
			{ source: "queue-sort", content: "sort", term: nextOrder },
		),
		sortLabel: sort.label,
		sortIconName: sort.iconName,
		offlineDownload: offlineDownloadControl({ filters, isEmpty: vm.isEmpty }),
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
		listingHeaderStateClass: vm.isEmpty
			? "readlist-listing__header--hidden"
			: "readlist-listing__header--visible",
		paginationStateClass: vm.isEmpty
			? "pagination--hidden"
			: "pagination--visible",
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
				? renderSubscribePlansPopover({ source: "queue-banner", checkedPlan: banner.checkedPlan })
				: "",
		saveTipHtml: options.saveTip.html,
		readerSkeletonHtml: renderReaderSkeleton({ cspNonce: options.cspNonce }),
	});

	const scripts = [readlistPageScripts(options.cspNonce)];
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
