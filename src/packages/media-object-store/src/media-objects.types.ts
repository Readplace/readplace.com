import type { UploadId } from "@packages/media-contracts";
import type { ObjectSha256 } from "./object-sha256";

export type ObjectMeta = {
	size: number;
	mediaType: string;
	generation: number;
	holders: number;
	state: "live" | "deleting";
};

export type MediaObjectRows = {
	readHolding: (params: { sha256: ObjectSha256; uploadId: UploadId }) => Promise<{
		meta: ObjectMeta | undefined;
		held: boolean;
	}>;
	writeHolding: (params: {
		sha256: ObjectSha256;
		uploadId: UploadId;
		meta: ObjectMeta;
		seen: ObjectMeta | undefined;
	}) => Promise<"written" | "conflict">;
	releaseHolding: (params: {
		sha256: ObjectSha256;
		uploadId: UploadId;
		meta: ObjectMeta;
		seen: ObjectMeta;
	}) => Promise<"released" | "conflict">;
	listHeldObjects: (params: { uploadId: UploadId }) => Promise<ObjectSha256[]>;
	readMeta: (params: { sha256: ObjectSha256 }) => Promise<ObjectMeta | undefined>;
	deleteHold: (params: { sha256: ObjectSha256; uploadId: UploadId }) => Promise<void>;
};

export type MediaObjectBytes = {
	deleteObject: (params: { key: string }) => Promise<void>;
};

export type HeldObject = { sha256: ObjectSha256; generation: number; key: string };

export type PutObjectBytes = (key: string) => Promise<void>;

export type RefObject = (params: {
	sha256: ObjectSha256;
	uploadId: UploadId;
	size: number;
	mediaType: string;
	putBytes: PutObjectBytes;
}) => Promise<HeldObject>;

export type UnrefAllForUpload = (params: { uploadId: UploadId }) => Promise<void>;

export type CollectObject = (params: { sha256: ObjectSha256 }) => Promise<void>;
