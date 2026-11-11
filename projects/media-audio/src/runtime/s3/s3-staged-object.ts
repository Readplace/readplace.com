import assert from "node:assert";
import { Readable } from "node:stream";
import { CopyObjectCommand, GetObjectCommand, NoSuchKey, type S3Client, S3ServiceException } from "@aws-sdk/client-s3";

const PRECONDITION_FAILED = 412;

export type StagedObject = { body: Readable; contentLength: number };
export type ReadStagedObject = (params: { key: string; etag: string }) => Promise<StagedObject | "staged-bytes-gone">;
export type CopyStagedTo = (params: { stagedKey: string; etag: string; targetKey: string; contentType: string }) => Promise<void>;

function isGone(error: unknown): boolean {
	return error instanceof NoSuchKey || (error instanceof S3ServiceException && error.$metadata.httpStatusCode === PRECONDITION_FAILED);
}

export function initS3StagedObject(deps: { client: Pick<S3Client, "send">; bucketName: string }): { readStagedObject: ReadStagedObject; copyStagedTo: CopyStagedTo } {
	const readStagedObject: ReadStagedObject = async ({ key, etag }) => {
		const response = await deps.client.send(new GetObjectCommand({ Bucket: deps.bucketName, Key: key, IfMatch: etag })).catch((error: unknown) => {
			if (isGone(error)) return "staged-bytes-gone" as const;
			throw error;
		});
		if (response === "staged-bytes-gone") return response;
		assert(response.Body instanceof Readable, `${key} has no readable body`);
		assert(response.ContentLength !== undefined, `${key} has no content length`);
		return { body: response.Body, contentLength: response.ContentLength };
	};

	const copyStagedTo: CopyStagedTo = async ({ stagedKey, etag, targetKey, contentType }) => {
		await deps.client.send(
			new CopyObjectCommand({
				Bucket: deps.bucketName,
				Key: targetKey,
				CopySource: `${deps.bucketName}/${stagedKey}`,
				CopySourceIfMatch: etag,
				ContentType: contentType,
				MetadataDirective: "REPLACE",
			}),
		);
	};

	return { readStagedObject, copyStagedTo };
}
