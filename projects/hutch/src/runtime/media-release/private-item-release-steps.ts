import type {
	DeleteArticleRow,
	DeleteContentObjects,
	DeleteUserArticleLinks,
	ListContentKeys,
	PurgeArticleContent,
} from "@packages/article-store";
import type { UserId } from "@packages/domain/user";
import { PrivateItemUrlSchema, uploadIdOfPrivateItemUrl } from "@packages/media-contracts";
import type { UnrefAllForUpload } from "@packages/media-object-store";
import type { FindItemOwner } from "@packages/provider-contracts/article-store";
import type { SettleStartedCharge } from "@packages/provider-contracts/transcript-quota";
import { COMMIT_ATTEMPT } from "../web/pages/upload/commit-received-upload";

export type ReleaseStep = (item: { url: string; userId: UserId }) => Promise<void>;

export type ReleasePrivateItem = (item: { url: string; userId: UserId }) => Promise<"released" | "not-owner">;

export function pendingOriginalKey(url: string): string {
	return `pending/${uploadIdOfPrivateItemUrl(PrivateItemUrlSchema.parse(url))}/original`;
}

export function bookImagesPrefix(url: string): string {
	return `images/${uploadIdOfPrivateItemUrl(PrivateItemUrlSchema.parse(url))}/`;
}

export function transcriptsPrefix(url: string): string {
	return `transcripts/${uploadIdOfPrivateItemUrl(PrivateItemUrlSchema.parse(url))}/`;
}

export function initPrivateItemReleaseSteps(deps: {
	purgeArticleContent: PurgeArticleContent;
	deleteMediaObjects: DeleteContentObjects;
	listMediaKeys: ListContentKeys;
	deleteArticleRow: DeleteArticleRow;
	mediaObjects: { unrefAll: UnrefAllForUpload };
	deleteUserArticleLinks: DeleteUserArticleLinks;
	settleStartedCharge: SettleStartedCharge;
}): readonly ReleaseStep[] {
	return [
		({ url }) => deps.purgeArticleContent(url),
		({ url }) => deps.deleteMediaObjects([pendingOriginalKey(url)]),
		({ url }) => deps.listMediaKeys(bookImagesPrefix(url)).then(deps.deleteMediaObjects),
		({ url }) => deps.listMediaKeys(transcriptsPrefix(url)).then(deps.deleteMediaObjects),
		async ({ url, userId }) => {
			await deps.settleStartedCharge({
				userId,
				uploadId: uploadIdOfPrivateItemUrl(PrivateItemUrlSchema.parse(url)),
				attempt: COMMIT_ATTEMPT,
			});
		},
		({ url }) => deps.deleteArticleRow(url),
		({ url }) => deps.mediaObjects.unrefAll({ uploadId: uploadIdOfPrivateItemUrl(PrivateItemUrlSchema.parse(url)) }),
		({ url }) => deps.deleteUserArticleLinks(url),
	];
}

export function initReleasePrivateItem(deps: {
	findItemOwner: FindItemOwner;
	steps: readonly ReleaseStep[];
}): ReleasePrivateItem {
	return async ({ url, userId }) => {
		const owner = await deps.findItemOwner(url);
		if (owner !== undefined && owner !== userId) return "not-owner";
		for (const step of deps.steps) {
			await step({ url, userId });
		}
		return "released";
	};
}
