import assert from "node:assert";
import type {
	AnonymousMediaUploadSession,
	AnyMediaUploadSession,
	MarkMediaUploadInspecting,
	MediaUploadSession,
	PublishMediaUploadStaged,
} from "@packages/domain";
import type { MediaKindManifest } from "@packages/media-contracts";
import { defaultFileNameOf, type SettleAnyReceivedUpload, type SettleReceivedUpload } from "./commit-received-upload";
import type { UploadOutcome } from "./upload.outcome";

export type StageForReview = (params: {
	session: AnonymousMediaUploadSession;
	kind: MediaKindManifest;
	etag: string;
	size: number;
}) => Promise<UploadOutcome<"staged-for-review">>;

export function initStageForReview(deps: {
	markMediaUploadInspecting: MarkMediaUploadInspecting;
	publishMediaUploadStaged: PublishMediaUploadStaged;
	now: () => Date;
}): StageForReview {
	return async ({ session, kind, etag, size }) => {
		const { uploadId } = session;
		const marked = await deps.markMediaUploadInspecting({
			uploadId,
			etag,
			kind: kind.name,
		});
		if (marked === "inspecting") {
			const [mediaType, ...others] = Object.keys(kind.accepts);
			assert(
				mediaType !== undefined && others.length === 0,
				`kind ${kind.name} must accept exactly one media type`,
			);
			await deps.publishMediaUploadStaged({
				uploadId,
				kind: kind.name,
				mediaType,
				fileName: session.fileName ?? defaultFileNameOf(kind),
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
	return async ({ session, kind, etag, size }) =>
		isSignedInMediaUploadSession(session)
			? deps.commitReceivedUpload({ session, kind, etag, size })
			: deps.stageForReview({ session, kind, etag, size });
}
