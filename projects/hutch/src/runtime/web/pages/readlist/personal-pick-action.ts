import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import type { SavedArticle } from "@packages/domain/article";

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

export function personalPickAction(article: SavedArticle, query: string) {
	const picked = article.personalPickedAt !== undefined;
	return {
		name: picked ? "remove-from-hand-picked" : "add-to-hand-picked",
		title: picked ? t("handPicked.remove") : t("handPicked.add"),
		href: `/queue/${article.id.value}/hand-picked${query}`,
		method: "POST" as const,
		type: "application/x-www-form-urlencoded",
		fields: [{ name: "membership", type: "hidden", value: picked ? "remove" : "add" }],
	};
}
