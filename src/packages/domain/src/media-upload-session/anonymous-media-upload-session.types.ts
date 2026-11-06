import type {
	MediaFailureReason,
	MediaInspectionFacts,
	MediaKindName,
	UploadId,
} from "@packages/media-contracts";
import type { UserId } from "../user/user.types";
import type { MediaUploadSession } from "./media-upload-session.types";

export type AnonymousMediaUploadSessionState = "staged" | "inspecting" | "ready" | "rejected";

export interface AnonymousMediaUploadSession {
	readonly uploadId: UploadId;
	readonly userId?: undefined;
	readonly kind: MediaKindName;
	readonly fileName: string;
	readonly byteLength?: number;
	readonly saveAttemptId: MediaUploadSession["saveAttemptId"];
	readonly status: AnonymousMediaUploadSessionState;
	readonly etag?: string;
	readonly facts?: MediaInspectionFacts;
	readonly reason?: MediaFailureReason;
	readonly notice?: string;
}

export type AnyMediaUploadSession = MediaUploadSession | AnonymousMediaUploadSession;

export type ClaimedMediaUpload = MediaUploadSession & { readonly etag: string };

export type MediaInspectionVerdict =
	| { readonly verdict: "inspected"; readonly facts: MediaInspectionFacts }
	| { readonly verdict: "rejected"; readonly reason: MediaFailureReason; readonly notice: string };

export type CreateAnyMediaUploadSession = (
	params: Omit<MediaUploadSession, "status" | "userId"> & { userId: UserId | undefined },
) => Promise<AnyMediaUploadSession>;

export type MarkMediaUploadInspecting = (params: {
	uploadId: UploadId;
	etag: string;
}) => Promise<"inspecting" | "not-staged">;

export type RecordMediaInspection = (params: {
	uploadId: UploadId;
	inspection: MediaInspectionVerdict;
}) => Promise<"ready" | "rejected" | "not-inspecting">;

export type ClaimMediaUpload = (params: {
	uploadId: UploadId;
	userId: UserId;
}) => Promise<ClaimedMediaUpload | "not-claimable">;

export type FindMediaUploadByCapability = (params: {
	uploadId: UploadId;
	userId: UserId | undefined;
}) => Promise<AnyMediaUploadSession | undefined>;

export type PublishMediaUploadStaged = (params: {
	uploadId: UploadId;
	kind: MediaKindName;
	mediaType: string;
	fileName: string;
	size: number;
	etag: string;
	stagedAt: string;
}) => Promise<void>;
