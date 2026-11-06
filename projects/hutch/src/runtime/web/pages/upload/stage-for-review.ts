import assert from "node:assert";
import type {
	AnonymousMediaUploadSession,
	AnyMediaUploadSession,
	MarkMediaUploadInspecting,
	MediaUploadSession,
	PublishMediaUploadStaged,
	ReadTimedDuration,
	RecordTimedMediaFacts,
} from "@packages/domain";
import { type MediaKindManifest, type Meter, isPlayableAudio } from "@packages/media-contracts";
import { defaultFileNameOf, type SettleAnyReceivedUpload, type SettleReceivedUpload } from "./commit-received-upload";
import type { UploadOutcome } from "./upload.outcome";
import { UPLOAD_REFUSAL_COPY } from "./upload.refusal";

export type StageForReview = (params: {
	session: AnonymousMediaUploadSession;
	kind: MediaKindManifest;
	etag: string;
	size: number;
}) => Promise<UploadOutcome<"staged-for-review">>;

export function initStageForReview(deps: {
	markMediaUploadInspecting: MarkMediaUploadInspecting;
	publishMediaUploadStaged: PublishMediaUploadStaged;
	recordTimedMediaFacts: RecordTimedMediaFacts;
	readDurationByMeter: ReadonlyMap<Meter, ReadTimedDuration>;
	now: () => Date;
}): StageForReview {
	return async ({ session, kind, etag, size }) => {
		const { uploadId } = session;
		if (kind.meter !== undefined) {
			const readDuration = deps.readDurationByMeter.get(kind.meter);
			assert(readDuration, `no duration reader for the ${kind.meter} meter`);
			const facts = await readDuration({ uploadId, etag });
			await deps.recordTimedMediaFacts({
				uploadId,
				etag,
				kind: kind.name,
				inspection:
					"unreadable" in facts || !isPlayableAudio(facts)
						? { verdict: "rejected", reason: "unreadable", notice: UPLOAD_REFUSAL_COPY["unreadable-audio"] }
						: { verdict: "inspected", facts: { kind: "audio", shape: "timed", durationSeconds: facts.durationSeconds } },
			});
			return { outcome: "staged-for-review", uploadId };
		}
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
