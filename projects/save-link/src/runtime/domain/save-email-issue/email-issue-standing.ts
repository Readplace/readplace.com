import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { ListUserSavesForUrl } from "@packages/provider-contracts/article-store";

export type EmailIssueStanding = { removedByReader: boolean; savedToAll: boolean; filedInto: ReadlistSlug[] };

export type FindEmailIssueStanding = (params: { userId: UserId; url: string }) => Promise<EmailIssueStanding>;

export function initFindEmailIssueStanding(deps: {
	findStoredDisplayUrl: (url: string) => Promise<string | undefined>;
	listUserSavesForUrl: ListUserSavesForUrl;
}): FindEmailIssueStanding {
	return async ({ userId, url }) => {
		const [displayUrl, saves] = await Promise.all([
			deps.findStoredDisplayUrl(url),
			deps.listUserSavesForUrl({ userId, url }),
		]);
		const savedToAll = saves.some((save) => save.readlist === undefined);
		const filedInto = saves.flatMap((save) => (save.readlist === undefined ? [] : [save.readlist]));
		return { removedByReader: displayUrl !== undefined && !savedToAll, savedToAll, filedInto };
	};
}
