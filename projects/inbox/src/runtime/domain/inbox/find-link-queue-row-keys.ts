import { equivalentArticleUrls } from "@packages/article-resource-unique-id";
import { unwrapWrapperUrl, validateSaveableUrl } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { FindIdentityRow, FindQueueRowKeys, QueueRowKey } from "@packages/provider-contracts/article-store";
import {
	initResolveCanonicalIdentity,
	initResolveSaveIdentity,
	neverResolveWrapperTarget,
} from "@packages/save-article";

export type FindLinkQueueRowKeys = (input: { userId: UserId; url: string }) => Promise<QueueRowKey[]>;

export function initFindLinkQueueRowKeys(deps: {
	findIdentityRow: FindIdentityRow;
	findQueueRowKeys: FindQueueRowKeys;
}): FindLinkQueueRowKeys {
	const resolveCanonicalIdentity = initResolveCanonicalIdentity({ findIdentityRow: deps.findIdentityRow });
	const replaySaveIdentity = initResolveSaveIdentity({
		validateUrl: validateSaveableUrl,
		findIdentityRow: deps.findIdentityRow,
		claimAlias: async () => {},
		resolveWrapperTarget: neverResolveWrapperTarget,
		now: () => new Date(),
	});

	return async ({ userId, url }) => {
		const replayed = await replaySaveIdentity(url);
		const roots = [
			url,
			await resolveCanonicalIdentity(url),
			unwrapWrapperUrl(url).url,
			...(replayed.status === "resolved" ? [replayed.url] : []),
		];
		const candidates = [...new Set(roots.flatMap((root) => [root, ...equivalentArticleUrls(root)]))];
		return deps.findQueueRowKeys({ userId, urls: candidates });
	};
}
