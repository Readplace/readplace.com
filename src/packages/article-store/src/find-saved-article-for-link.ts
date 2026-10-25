import assert from "node:assert";
import { prepareNewSaveUrl, ReaderArticleHashId, validateSaveableUrl } from "@packages/domain/article";
import type {
	FindArticleById,
	FindSavedArticleForLink,
	ResolveCanonicalIdentity,
} from "@packages/provider-contracts/article-store";

export function initFindSavedArticleForLink(deps: {
	resolveCanonicalIdentity: ResolveCanonicalIdentity;
	findArticleById: FindArticleById;
}): FindSavedArticleForLink {
	return async (input) => {
		const validation = validateSaveableUrl(input.url);
		assert(validation.status === "SUCCESS", "a link handed to the readlist lookup is saveable");
		const resolvedUrl = await deps.resolveCanonicalIdentity(prepareNewSaveUrl(validation.url));
		const article = await deps.findArticleById(ReaderArticleHashId.from(resolvedUrl), input.userId);
		return article === null ? { kind: "not-saved", resolvedUrl } : { kind: "saved", resolvedUrl, article };
	};
}
