import { isPrivateItemUrl } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { ReleasePrivateItem } from "./private-item-release-steps";

export type ReleasePrivateItems = (account: { userId: UserId; urls: readonly string[] }) => Promise<void>;

export function initReleasePrivateItems(deps: { releasePrivateItem: ReleasePrivateItem }): ReleasePrivateItems {
	return async ({ userId, urls }) => {
		for (const url of urls.filter(isPrivateItemUrl)) {
			await deps.releasePrivateItem({ url, userId });
		}
	};
}
