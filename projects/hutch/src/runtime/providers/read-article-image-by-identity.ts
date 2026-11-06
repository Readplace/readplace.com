import { isPrivateItemUrl } from "@packages/domain/article";
import type { ReadArticleImage } from "@packages/provider-contracts/article-store";

export function initReadArticleImageByIdentity(deps: { shared: ReadArticleImage; private: ReadArticleImage }): ReadArticleImage {
	return (query) => (isPrivateItemUrl(query.url) ? deps.private(query) : deps.shared(query));
}
