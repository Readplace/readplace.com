import assert from "node:assert";
import type {
	AnonymousMediaUploadSession,
	AnyMediaUploadSession,
	MarkMediaUploadInspecting,
	MediaUploadSession,
	PublishMediaUploadStaged,
} from "@packages/domain";
import type { MediaKindManifest, MediaKindName } from "@packages/media-contracts";
import type { SettleAnyReceivedUpload, SettleReceivedUpload } from "./commit-received-upload";
import type { UploadOutcome } from "./upload.outcome";

export type StageForReview = (params: {
	session: AnonymousMediaUploadSession;
	etag: string;
	size: number;
}) => Promise<UploadOutcome<"staged-for-review">>;

export function initStageForReview(deps: {
	markMediaUploadInspecting: MarkMediaUploadInspecting;
	publishMediaUploadStaged: PublishMediaUploadStaged;
	MEDIA_KINDS: ReadonlyMap<MediaKindName, MediaKindManifest>;
	now: () => Date;
}): StageForReview {
	return async ({ session, etag, size }) => {
		const { uploadId, kind, fileName } = session;
		const marked = await deps.markMediaUploadInspecting({ uploadId, etag });
		if (marked === "inspecting") {
			const manifest = deps.MEDIA_KINDS.get(kind);
			assert(manifest, `staged upload of unknown kind ${kind}`);
			const [mediaType, ...others] = Object.keys(manifest.accepts);
			assert(mediaType !== undefined && others.length === 0, `kind ${kind} must accept exactly one media type`);
			await deps.publishMediaUploadStaged({
				uploadId,
				kind,
				mediaType,
				fileName,
				size,
				etag,
				stagedAt: deps.now().toISOString(),
			});
		}
		return { outcome: "staged-for-review", uploadId };
	};
}

export function isSignedInMediaUploadSession(session: AnyMediaUploadSession): session is MediaUploadSession {
	return session.userId !== undefined;
}

export function initSettleByCaller(deps: {
	commitReceivedUpload: SettleReceivedUpload;
	stageForReview: StageForReview;
}): SettleAnyReceivedUpload {
	return async ({ session, etag, size }) =>
		isSignedInMediaUploadSession(session)
			? deps.commitReceivedUpload({ session, etag, size })
			: deps.stageForReview({ session, etag, size });
}
