import assert from "node:assert";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, NoSuchKey, S3ServiceException } from "@aws-sdk/client-s3";
import type { UploadId } from "@packages/media-contracts";

const PRECONDITION_FAILED = 412;

export type StagedObject = { bytes: Uint8Array; sha256: string };
export type DownloadStagedObject = (params: { uploadId: UploadId; etag: string }) => Promise<StagedObject | "staged-bytes-gone">;

export function isGone(error: unknown): boolean {
	return error instanceof NoSuchKey || (error instanceof S3ServiceException && error.$metadata.httpStatusCode === PRECONDITION_FAILED);
}

export function initDownloadStagedObject(deps: { client: { send: (command: GetObjectCommand) => Promise<{ Body?: unknown }> }; bucketName: string; tmpDir: string }): DownloadStagedObject {
	return async ({ uploadId, etag }) => {
		const response = await deps.client
			.send(new GetObjectCommand({ Bucket: deps.bucketName, Key: `pending/${uploadId}/original`, IfMatch: etag }))
			.catch((error: unknown) => {
				if (isGone(error)) return "staged-bytes-gone" as const;
				throw error;
			});
		if (response === "staged-bytes-gone") return response;
		const path = join(deps.tmpDir, `${uploadId}.epub`);
		const hash = createHash("sha256");
		const body = response.Body;
		assert(body instanceof Readable, `pending/${uploadId}/original has no readable body`);
		body.on("data", (chunk: Uint8Array) => hash.update(chunk));
		try {
			await pipeline(body, createWriteStream(path));
			return { bytes: new Uint8Array(await readFile(path)), sha256: hash.digest("hex") };
		} finally {
			await rm(path, { force: true });
		}
	};
}
