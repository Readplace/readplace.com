import type {
	AnyMediaUploadSession,
	MarkMediaUploadCommitted,
	MediaUploadSession,
	PublishMediaUploadCommitted,
} from "@packages/domain";
import { type MediaKindManifest, mintPrivateItemUrl } from "@packages/media-contracts";
import type { SavePrivateItem } from "@packages/provider-contracts/article-store";
import type { UploadOutcome } from "./upload.outcome";
import type { UploadRefusalReason } from "./upload.refusal";

export const COMMIT_ATTEMPT = 1;

export type SettleReceivedUpload = (params: {
	session: MediaUploadSession;
	kind: MediaKindManifest;
	etag: string;
	size: number;
	chargedSeconds?: number;
}) => Promise<UploadOutcome<"committed" | UploadRefusalReason>>;

export type SettleAnyReceivedUpload = (params: {
	session: AnyMediaUploadSession;
	kind: MediaKindManifest;
	etag: string;
	size: number;
}) => Promise<UploadOutcome<"committed" | "staged-for-review" | UploadRefusalReason>>;

export function defaultFileNameOf(kind: MediaKindManifest): string {
	return `${kind.label} upload`;
}

export function initCommitReceivedUpload(deps: {
	savePrivateItem: SavePrivateItem;
	publishMediaUploadCommitted: PublishMediaUploadCommitted;
	markMediaUploadCommitted: MarkMediaUploadCommitted;
	now: () => Date;
}): SettleReceivedUpload {
	return async ({ session, kind, etag, chargedSeconds }) => {
		const { uploadId, userId, saveAttemptId } = session;
		const url = mintPrivateItemUrl(uploadId);
		const media = {
			kind: kind.name,
			fileName: session.fileName ?? defaultFileNameOf(kind),
		};
		await deps.savePrivateItem({
			url,
			ownerUserId: userId,
			media,
			savedAt: deps.now(),
		});
		await deps.publishMediaUploadCommitted({
			uploadId,
			kind: kind.name,
			url,
			userId,
			saveAttemptId,
			etag,
			attempt: COMMIT_ATTEMPT,
			...(chargedSeconds === undefined ? {} : { chargedSeconds }),
		});
		await deps.markMediaUploadCommitted({ uploadId, userId });
		return { outcome: "committed", uploadId };
	};
}
