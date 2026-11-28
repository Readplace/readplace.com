import assert from "node:assert/strict";
import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { GMAIL_RAW_RETENTION_MS } from "@packages/domain/gmail";
import { batchGetFromTable, type DynamoDBDocumentClient } from "@packages/storage-client";
import { z } from "zod";

const ClockRow = z.object({
	userId: z.string(),
	recordKey: z.string(),
	firstCapturedAt: z.number().finite().optional(),
	createdAt: z.iso.datetime().optional(),
});

type RowKey = { userId: string; recordKey: string };
const id = (key: RowKey) => JSON.stringify([key.userId, key.recordKey]);

export function initGmailRawCleanup(deps: {
	s3: Pick<S3Client, "send">;
	db: Pick<DynamoDBDocumentClient, "send">;
	bucketName: string;
	tableName: string;
	now: () => number;
}) {
	async function dueKeys(keys: string[], cutoff: number) {
		const clocks = new Map<string, RowKey>();
		const objects = keys.map((key) => {
			const match = /^gmail-import\/([^/]+)\/([^/]+)\/([^/]+)\.eml$/.exec(key);
			if (!match) return { key };
			const [, userId, jobId, messageId] = match;
			const capture = { userId, recordKey: `RAW#${jobId}#${messageId}` };
			const job = { userId, recordKey: `JOB#${jobId}` };
			clocks.set(id(capture), capture);
			clocks.set(id(job), job);
			return { key, capture, job };
		});
		const rows = await batchGetFromTable({
			client: deps.db, tableName: deps.tableName, schema: ClockRow,
			keys: [...clocks.values()], projection: ["userId", "recordKey", "firstCapturedAt", "createdAt"], consistentRead: true,
		});
		const timestamps = new Map(rows.map((row) => [
			id(row), row.firstCapturedAt ?? (row.createdAt ? Date.parse(row.createdAt) : undefined),
		]));
		return objects.filter(({ capture, job }) => {
			// A legacy job predates its first capture. Orphaned objects have no
			// recoverable lower bound, so they are due on the first sweep.
			const at = capture && job && (timestamps.get(id(capture)) ?? timestamps.get(id(job)));
			return !at || at <= cutoff;
		}).map(({ key }) => key);
	}

	return async () => {
		const cutoff = deps.now() - GMAIL_RAW_RETENTION_MS;
		let token: string | undefined;
		let deleted = 0;
		let failed = 0;
		do {
			const page = await deps.s3.send(new ListObjectsV2Command({
				Bucket: deps.bucketName, Prefix: "gmail-import/", ContinuationToken: token, MaxKeys: 100,
			}));
			const keys = (page.Contents ?? []).map(({ Key }) => {
				assert(typeof Key === "string", "unexpected raw-import listing");
				assert(Key.startsWith("gmail-import/"), "unexpected raw-import listing");
				return Key;
			});
			const due = await dueKeys(keys, cutoff);
			if (due.length) {
				const result = await deps.s3.send(new DeleteObjectsCommand({
					Bucket: deps.bucketName, Delete: { Objects: due.map((Key) => ({ Key })) },
				}));
				const errors = result.Errors?.length ?? 0;
				failed += errors;
				deleted += due.length - errors;
			}
			token = page.NextContinuationToken;
			assert(!page.IsTruncated || token, "raw-import listing missing continuation token");
		} while (token);
		assert.equal(failed, 0, `raw-import cleanup failed to delete ${failed} objects`);
		return { deleted };
	};
}
