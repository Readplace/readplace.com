import type { SaveProvenance } from "@packages/domain/article";

export const NOT_INTENTIONAL_SAVE_KINDS: ReadonlySet<SaveProvenance["kind"]> = new Set([
	"email",
	"import",
	"founder-seed",
	"hn-suggestion",
]);

export function isIntentionalSave(article: { provenance?: SaveProvenance }): boolean {
	return article.provenance === undefined || !NOT_INTENTIONAL_SAVE_KINDS.has(article.provenance.kind);
}
