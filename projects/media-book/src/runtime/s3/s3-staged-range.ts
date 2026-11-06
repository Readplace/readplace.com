import assert from "node:assert";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { UploadId } from "@packages/media-contracts";
import type { ByteRange } from "../epub/ranged-zip-directory";
import { isGone } from "./download-staged-object";

export type ReadStagedRange = (params: { uploadId: UploadId; etag: string; range: ByteRange }) => Promise<Uint8Array | "staged-bytes-gone">;

function rangeHeader(range: ByteRange): string {
	return "suffixLength" in range ? `bytes=-${range.suffixLength}` : `bytes=${range.start}-${range.end}`;
}

export function initReadStagedRange(deps: {
	client: { send: (command: GetObjectCommand) => Promise<{ Body?: { transformToByteArray: () => Promise<Uint8Array> } }> };
	bucketName: string;
}): ReadStagedRange {
	return async ({ uploadId, etag, range }) => {
		const response = await deps.client
			.send(new GetObjectCommand({ Bucket: deps.bucketName, Key: `pending/${uploadId}/original`, IfMatch: etag, Range: rangeHeader(range) }))
			.catch((error: unknown) => {
				if (isGone(error)) return "staged-bytes-gone" as const;
				throw error;
			});
		if (response === "staged-bytes-gone") return response;
		assert(response.Body, `pending/${uploadId}/original answered a ranged read with no body`);
		return response.Body.transformToByteArray();
	};
}
