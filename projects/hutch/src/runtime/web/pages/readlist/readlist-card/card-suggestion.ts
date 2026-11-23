import type { SavedArticle } from "@packages/domain/article";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReader } from "@packages/translations/hutch-reader";

const { t } = translator(hutchReader, DEFAULT_LOCALE);

export function cardSuggestionLabel(article: Pick<SavedArticle, "provenance">): string | undefined {
	return article.provenance?.kind === "hn-suggestion" ? t("articleBody.provenance.hnSuggestion") : undefined;
}
