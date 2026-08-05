import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArticleStatus } from "@packages/domain/article";
import type { RelatedArticles } from "@packages/provider-contracts/related-articles";
import { render } from "@packages/web-shell";

const RELATED_SLOT_TEMPLATE = readFileSync(
	join(__dirname, "related-slot.template.html"),
	"utf-8",
);

const VISIBLE_CLASS = "article-body__related-slot--visible";
const HIDDEN_CLASS = "article-body__related-slot--hidden";

export interface RelatedSlotContext {
	articles: RelatedArticles;
	/** The article whose reader shows the slot. Rides `utm_term` on every
	 * relation link, so a click records the source→target pair rather than only
	 * the target the path already carries. */
	sourceArticleId: string;
}

export interface RelatedSlotInput {
	related?: RelatedSlotContext;
	pollUrl?: string;
}

interface RelatedSlotItem {
	id: string;
	href: string;
	title: string;
	siteName: string;
	reason: string;
	readStatus: ArticleStatus;
	statusClass: string;
	statusLabel: string;
}

const STATUS_BADGE = {
	unread: { className: "related-slot__status--unread", label: "Unread" },
	read: { className: "related-slot__status--read", label: "Read" },
} satisfies Record<ArticleStatus, { className: string; label: string }>;

function relatedHref(params: {
	targetArticleId: string;
	sourceArticleId: string;
}): string {
	const search = new URLSearchParams([
		["utm_source", "reader"],
		["utm_medium", "internal"],
		["utm_content", "related"],
		["utm_term", params.sourceArticleId],
	]);
	return `/queue/${params.targetArticleId}/view?${search.toString()}`;
}

function itemsOf(related: RelatedSlotContext | undefined): RelatedSlotItem[] {
	if (related?.articles.status !== "ready") return [];
	return related.articles.items.map((item) => ({
		id: item.id.value,
		href: relatedHref({
			targetArticleId: item.id.value,
			sourceArticleId: related.sourceArticleId,
		}),
		title: item.title,
		siteName: item.siteName,
		reason: item.reason,
		readStatus: item.status,
		statusClass: STATUS_BADGE[item.status].className,
		statusLabel: STATUS_BADGE[item.status].label,
	}));
}

export function renderRelatedSlot(input: RelatedSlotInput): string {
	const items = itemsOf(input.related);
	const status = input.related?.articles.status ?? "pending";
	return render(RELATED_SLOT_TEMPLATE, {
		status,
		stateClass: items.length > 0 ? VISIBLE_CLASS : HIDDEN_CLASS,
		pollUrl: status === "pending" ? input.pollUrl : undefined,
		items,
	});
}
