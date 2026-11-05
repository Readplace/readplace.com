import type { MarkMediaUploadCommitted, MediaUploadSession, PublishMediaUploadCommitted } from "@packages/domain";
import { mintPrivateItemUrl } from "@packages/media-contracts";
import type { SavePrivateItem } from "@packages/provider-contracts/article-store";
import type { UploadOutcome } from "./upload.outcome";

export type SettleReceivedUpload = (params: {
	session: MediaUploadSession;
	etag: string;
	size: number;
}) => Promise<UploadOutcome<"committed">>;

export function initCommitReceivedUpload(deps: {
	savePrivateItem: SavePrivateItem;
	publishMediaUploadCommitted: PublishMediaUploadCommitted;
	markMediaUploadCommitted: MarkMediaUploadCommitted;
	now: () => Date;
}): SettleReceivedUpload {
	return async ({ session, etag }) => {
		const { uploadId, userId, kind, fileName, saveAttemptId } = session;
		const url = mintPrivateItemUrl(uploadId);
		await deps.savePrivateItem({ url, ownerUserId: userId, media: { kind, fileName }, savedAt: deps.now() });
		await deps.publishMediaUploadCommitted({ uploadId, kind, url, userId, saveAttemptId, etag, attempt: 1 });
		await deps.markMediaUploadCommitted({ uploadId, userId });
		return { outcome: "committed", uploadId };
	};
}
