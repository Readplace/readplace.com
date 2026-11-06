import type { Enclosure } from "@packages/media-contracts";
import type { SavedArticle } from "./article.types";
import { isPrivateItemUrl, mayReadItem, type Viewer } from "./private-item-access";

export type EnclosureRead = { readonly kind: "owned"; readonly enclosure: Enclosure } | { readonly kind: "absent" };

export const ABSENT_ENCLOSURE: EnclosureRead = { kind: "absent" };

type EnclosureHolder = Pick<SavedArticle, "url" | "ownerUserId" | "enclosure">;

export function ownedEnclosure(read: { viewer: Viewer; article: EnclosureHolder }): EnclosureRead {
	const { article } = read;
	if (article.enclosure === undefined) return ABSENT_ENCLOSURE;
	if (!isPrivateItemUrl(article.url)) return ABSENT_ENCLOSURE;
	if (!mayReadItem({ url: article.url, viewer: read.viewer, ownerUserId: article.ownerUserId })) return ABSENT_ENCLOSURE;
	return { kind: "owned", enclosure: article.enclosure };
}

export function ownedEnclosuresByUrl(read: {
	viewer: Viewer;
	articles: readonly EnclosureHolder[];
}): ReadonlyMap<string, EnclosureRead> {
	return new Map(read.articles.map((article) => [article.url, ownedEnclosure({ viewer: read.viewer, article })]));
}
