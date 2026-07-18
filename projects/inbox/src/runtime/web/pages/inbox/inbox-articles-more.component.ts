import { renderInboxArticleCard } from "./inbox-article-card.component";
import { renderInboxShowMore } from "./inbox-articles-show-more.component";
import type { ArticleCardsPage } from "./inbox-email-detail.viewmodel";

export function renderInboxArticlesMore(vm: ArticleCardsPage): string {
	const cards = vm.cards.map(renderInboxArticleCard).join("");
	return vm.showMore === undefined ? cards : cards + renderInboxShowMore(vm.showMore);
}
