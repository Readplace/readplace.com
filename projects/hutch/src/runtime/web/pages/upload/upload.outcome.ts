import type { Request, Response } from "express";
import type { MediaKindManifest, MediaKindName, UploadId } from "@packages/media-contracts";
import type { BuildBannerState } from "../../banner-state";
import type { UploadErrorCode } from "./upload.error";

type UploadOutcomePayloads = {
	staged: {
		uploadId: UploadId;
		kind: MediaKindName;
		post: { url: string; fields: Readonly<Record<string, string>> };
		uploadCeilingBytes: number;
	};
	committed: { uploadId: UploadId };
	continue: { uploadId: UploadId };
	failed: { uploadId: UploadId };
} & { [C in UploadErrorCode]: Record<never, never> };

export type UploadOutcomeKey = keyof UploadOutcomePayloads;

export type UploadOutcome<K extends UploadOutcomeKey = UploadOutcomeKey> = {
	[P in K]: { outcome: P } & UploadOutcomePayloads[P];
}[K];

export type UploadOutcomeWriters = {
	[K in UploadOutcomeKey]: (res: Response, outcome: UploadOutcome<K>, context: UploadWriteContext) => void;
};

export type UploadWriteContext = {
	req: Request;
	bannerState: Awaited<ReturnType<BuildBannerState>>;
	kinds: ReadonlyMap<MediaKindName, MediaKindManifest>;
};

export function writeUploadOutcome<K extends UploadOutcomeKey>(params: {
	writers: UploadOutcomeWriters;
	res: Response;
	outcome: UploadOutcome<K>;
	context: UploadWriteContext;
}): void {
	const { writers, res, outcome, context } = params;
	writers[outcome.outcome](res, outcome, context);
}
