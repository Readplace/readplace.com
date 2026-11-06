import assert from "node:assert";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import type { UploadId } from "@packages/media-contracts";
import { initDynamoDbMediaObjects } from "./dynamodb-media-objects";
import type {
	CollectObject,
	MediaObjectBytes,
	MediaObjectRows,
	ObjectMeta,
	RefObject,
	UnrefAllForUpload,
} from "./media-objects.types";
import { type ObjectSha256, objectKey } from "./object-sha256";
import { initS3MediaObjects } from "./s3-media-objects";

type MediaObjectStore = { ref: RefObject; unrefAll: UnrefAllForUpload; gc: CollectObject };

export function initMediaObjectHoldings(deps: {
	rows: MediaObjectRows;
	bytes: MediaObjectBytes;
}): MediaObjectStore {
	const { rows, bytes } = deps;

	const gc: CollectObject = async ({ sha256 }) => {
		const meta = await rows.readMeta({ sha256 });
		if (meta?.state !== "deleting") return;
		await bytes.deleteObject({ key: objectKey({ sha256, generation: meta.generation }) });
	};

	const ref: RefObject = async ({ sha256, uploadId, size, mediaType, putBytes }) => {
		for (;;) {
			const { meta: seen, held } = await rows.readHolding({ sha256, uploadId });
			if (held) {
				assert(seen, `ref#${uploadId} exists without a meta row for ${sha256}`);
				return { sha256, generation: seen.generation, key: objectKey({ sha256, generation: seen.generation }) };
			}
			const live = seen?.state === "live";
			const meta: ObjectMeta = live
				? { ...seen, holders: seen.holders + 1 }
				: {
						size,
						mediaType,
						generation: seen === undefined ? 1 : seen.generation + 1,
						holders: 1,
						state: "live",
					};
			const key = objectKey({ sha256, generation: meta.generation });
			if (!live) await putBytes(key);
			const outcome = await rows.writeHolding({ sha256, uploadId, meta, seen });
			if (outcome === "conflict") continue;
			if (seen?.state === "deleting") {
				await bytes.deleteObject({ key: objectKey({ sha256, generation: seen.generation }) });
			}
			return { sha256, generation: meta.generation, key };
		}
	};

	const release = async (params: { sha256: ObjectSha256; uploadId: UploadId }): Promise<void> => {
		for (;;) {
			const { meta: seen, held } = await rows.readHolding(params);
			if (!held) return;
			assert(seen, `ref#${params.uploadId} exists without a meta row for ${params.sha256}`);
			const holders = seen.holders - 1;
			const meta: ObjectMeta = { ...seen, holders, state: holders === 0 ? "deleting" : "live" };
			const outcome = await rows.releaseHolding({ ...params, meta, seen });
			if (outcome === "released") return;
		}
	};

	const unrefAll: UnrefAllForUpload = async ({ uploadId }) => {
		const held = await rows.listHeldObjects({ uploadId });
		for (const sha256 of held) {
			await release({ sha256, uploadId });
			await gc({ sha256 });
			await rows.deleteHold({ sha256, uploadId });
		}
	};

	return { ref, unrefAll, gc };
}

export function initMediaObjectStore(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	tableName: string;
	s3: Pick<S3Client, "send">;
	bucketName: string;
}): MediaObjectStore {
	return initMediaObjectHoldings({
		rows: initDynamoDbMediaObjects({ client: deps.client, tableName: deps.tableName }),
		bytes: initS3MediaObjects({ client: deps.s3, bucketName: deps.bucketName }),
	});
}
