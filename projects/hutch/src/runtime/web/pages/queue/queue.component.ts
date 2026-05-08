import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OnboardingChecklist, ONBOARDING_STYLES } from "../../onboarding/onboarding.component";
import type { BrowserName } from "../../onboarding/onboarding.types";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { QUEUE_STYLES } from "./queue.styles";
import type { ArticleAction, QueueArticleViewModel, QueueViewModel } from "./queue.viewmodel";
import { buildQueueUrl } from "./queue.url";
import { tabQuery } from "./queue.tabs";

const QUEUE_TEMPLATE = readFileSync(join(__dirname, "queue.template.html"), "utf-8");

interface ActionDisplayModel extends ArticleAction {
	buttonClass: string;
}

interface ArticleDisplayModel extends QueueArticleViewModel {
	linkUrl: string;
	unreadClass: string;
	actions: ActionDisplayModel[];
}

function toActionDisplayModel(action: ArticleAction): ActionDisplayModel {
	return {
		...action,
		buttonClass: action.testAction === "delete"
			? "queue-article__action-btn queue-article__action-btn--delete"
			: "queue-article__action-btn",
	};
}

function toArticleDisplayModel(article: QueueArticleViewModel): ArticleDisplayModel {
	return {
		...article,
		linkUrl: `/queue/${article.id}/read`,
		unreadClass: article.isUnread ? " queue-article--unread" : "",
		actions: article.actions.map(toActionDisplayModel),
	};
}

interface QueueDisplayModel {
	total: number;
	pluralSuffix: string;
	saveError?: string;
	importFlash?: string;
	showImportForm: boolean;
	isEmpty: boolean;
	hasArticles: boolean;
	onboardingHtml: string;
	articles: ArticleDisplayModel[];
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
}

function filterLinkClass(isActive: boolean): string {
	return `queue__filter-link${isActive ? " queue__filter-link--active" : ""}`;
}

export function formatUnreadLabel(count: number): string {
	return count > 99 ? "To read (99+)" : `To read (${count})`;
}

function toQueueDisplayModel(vm: QueueViewModel, options: { extensionInstalled: boolean; extensionSavedArticle: boolean; browser: BrowserName; onboardingDismissed: boolean; showImportForm: boolean }): QueueDisplayModel {
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

	return {
		total: vm.total,
		pluralSuffix: vm.total !== 1 ? "s" : "",
		saveError: vm.saveError,
		importFlash: vm.importFlash,
		showImportForm: options.showImportForm,
		isEmpty: vm.isEmpty,
		hasArticles: !vm.isEmpty,
		onboardingHtml,
		articles: vm.articles.map(toArticleDisplayModel),
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

const IMPORT_AUTO_SUBMIT_SCRIPT = `
<script>
	(function () {
		function wire() {
			var form = document.querySelector('form.queue__import-form');
			if (!form) return;
			var input = form.querySelector('input[type="file"]');
			if (!input) return;
			input.addEventListener('change', function () {
				if (input.files && input.files.length > 0) form.requestSubmit();
			});
		}
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', wire, { once: true });
		} else {
			wire();
		}
	})();
</script>
`;

export function QueuePage(vm: QueueViewModel, options?: { saveUrl?: string; extensionInstalled?: boolean; extensionSavedArticle?: boolean; browser?: BrowserName; onboardingDismissed?: boolean; showImportForm?: boolean; statusCode?: number }): PageBody {
	const saveUrl = options?.saveUrl;
	const showImportForm = options?.showImportForm ?? false;
	const displayModel = toQueueDisplayModel(vm, { extensionInstalled: options?.extensionInstalled ?? false, extensionSavedArticle: options?.extensionSavedArticle ?? false, browser: options?.browser ?? "other", onboardingDismissed: options?.onboardingDismissed ?? false, showImportForm });
	const content = render(QUEUE_TEMPLATE, { ...displayModel, saveUrl });

	const scriptParts: string[] = [IMPORT_AUTO_SUBMIT_SCRIPT];
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
