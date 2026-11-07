/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { readFile } from "node:fs/promises";
import {
	DeleteObjectsCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	NoSuchKey,
	PutObjectCommand,
	type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
	type JobRequest,
	JobRequestSchema,
} from "../prepare/transcription-keys";

const PRESIGNED_GET_SECONDS = 900;

export function initS3TranscriptFiles(deps: {
	client: S3Client;
	bucketName: string;
}) {
	const stagedInputUrl = async ({ key }: { key: string }): Promise<string> =>
		getSignedUrl(
			deps.client,
			new GetObjectCommand({ Bucket: deps.bucketName, Key: key }),
			{ expiresIn: PRESIGNED_GET_SECONDS },
		);

	const putTranscriptFile = async ({
		key,
		path,
	}: {
		key: string;
		path: string;
	}): Promise<void> => {
		await deps.client.send(
			new PutObjectCommand({
				Bucket: deps.bucketName,
				Key: key,
				Body: await readFile(path),
			}),
		);
	};

	const putJobRequest = async ({
		key,
		request,
	}: {
		key: string;
		request: JobRequest;
	}): Promise<void> => {
		await deps.client.send(
			new PutObjectCommand({
				Bucket: deps.bucketName,
				Key: key,
				Body: JSON.stringify(request),
				ContentType: "application/json",
			}),
		);
	};

	const readJobRequest = async ({
		key,
	}: {
		key: string;
	}): Promise<JobRequest | undefined> => {
		const response = await deps.client
			.send(new GetObjectCommand({ Bucket: deps.bucketName, Key: key }))
			.catch((error: unknown) => {
				if (error instanceof NoSuchKey) return undefined;
				throw error;
			});
		if (response?.Body === undefined) return undefined;
		return JobRequestSchema.parse(
			JSON.parse(await response.Body.transformToString()),
		);
	};

	const readTranscriptOutput = async ({
		key,
	}: {
		key: string;
	}): Promise<unknown> => {
		const response = await deps.client.send(
			new GetObjectCommand({ Bucket: deps.bucketName, Key: key }),
		);
		return JSON.parse((await response.Body?.transformToString()) ?? "null");
	};

	const deletePrefix = async (prefix: string): Promise<void> => {
		const listed = await deps.client.send(
			new ListObjectsV2Command({ Bucket: deps.bucketName, Prefix: prefix }),
		);
		const objects = (listed.Contents ?? []).flatMap((object) =>
			object.Key ? [{ Key: object.Key }] : [],
		);
		if (objects.length === 0) return;
		await deps.client.send(
			new DeleteObjectsCommand({
				Bucket: deps.bucketName,
				Delete: { Objects: objects },
			}),
		);
	};

	return {
		stagedInputUrl,
		putTranscriptFile,
		putJobRequest,
		readJobRequest,
		readTranscriptOutput,
		deletePrefix,
	};
}
/* c8 ignore stop */
