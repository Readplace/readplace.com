import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RelatedArticles } from "@packages/provider-contracts/related-articles";
import { render, toRelativePhrase } from "@packages/web-shell";
import type { LocalTime } from "@packages/web-shell/local-time.format";

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
	now: Date;
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
	saved: LocalTime;
}

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
		saved: toRelativePhrase({ iso: item.savedAt.toISOString(), now: related.now }),
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
