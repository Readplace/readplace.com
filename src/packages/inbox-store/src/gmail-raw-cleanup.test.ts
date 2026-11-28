import { type S3Client, ListObjectsV2Command, type DeleteObjectsCommand } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { initGmailRawCleanup } from "./gmail-raw-cleanup";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-27T12:00:00Z");
const RAW = "gmail-import/reader/job/";
const ISSUE = "content/saved-issue/content.html";

function harness() {
	const old = NOW - 30 * DAY;
	const contents = new Map([
		[`${RAW}first.eml`, "raw 1"], [`${RAW}later.eml`, "raw 2"],
		[`${RAW}legacy.eml`, "raw 3"], ["gmail-import/reader/missing/noClock.eml", "orphan"], [`${RAW}boundary.eml`, "raw 4"],
		["gmail-import/orphan", "raw 5"], [ISSUE, "<p>Saved synthetic issue</p>"],
		["inbound/forwarded", "forwarded"],
	]);
	const timestamps: Record<string, number> = { first: old, later: NOW - DAY, boundary: NOW - 29 * DAY };
	let clock = NOW;
	let partialFailure = true;
	const s3 = { send: async (command: ListObjectsV2Command | DeleteObjectsCommand) => {
		expect(command.input.Bucket).toBe("raw-bucket");
		if (command instanceof ListObjectsV2Command) {
			expect(command.input.Prefix).toBe("gmail-import/");
			// Continue by key rather than array offset as the sweep deletes each page.
			const page = [...contents.keys()].filter((key) => key.startsWith("gmail-import/") && key > (command.input.ContinuationToken ?? "")).sort();
			return { Contents: page.slice(0, 2).map((Key) => ({ Key, LastModified: new Date(NOW) })), NextContinuationToken: page.length > 2 ? page[1] : undefined, IsTruncated: page.length > 2 };
		}
		const errors = [];
		for (const { Key } of command.input.Delete?.Objects ?? []) {
			if (!Key) throw new Error("missing key");
			if (partialFailure && Key === `${RAW}first.eml`) errors.push({ Key, Code: "AccessDenied" });
			else contents.delete(Key);
		}
		return errors.length ? { Errors: errors } : {};
	} } as unknown as Pick<S3Client, "send">;
	const db = { send: async (command: { input: { RequestItems: { imports: { Keys: { userId: string; recordKey: string }[] } } } }) => {
		const rows = command.input.RequestItems.imports.Keys.map((key) => {
			if (key.recordKey === "JOB#missing") return key;
			if (key.recordKey.startsWith("JOB#")) return { ...key, createdAt: new Date(old).toISOString() };
			const firstCapturedAt = timestamps[key.recordKey.split("#")[2]];
			return firstCapturedAt === undefined ? undefined : { ...key, firstCapturedAt };
		}).filter(Boolean);
		return { Responses: { imports: rows } };
	} } as unknown as Pick<DynamoDBDocumentClient, "send">;
	return {
		run: initGmailRawCleanup({ s3, db, bucketName: "raw-bucket", tableName: "imports", now: () => clock }),
		contents, recover: () => { partialFailure = false; }, advance: (ms: number) => { clock += ms; },
	};
}

describe("Gmail raw-import cleanup", () => {
	it("allows an empty bucket and fails malformed or incomplete lists before reporting success", async () => {
		const run = (page: object) => initGmailRawCleanup({
			s3: { send: async () => page } as unknown as Pick<S3Client, "send">,
			db: { send: async () => { throw new Error("unexpected metadata read"); } } as unknown as Pick<DynamoDBDocumentClient, "send">,
			tableName: "imports", bucketName: "raw-bucket", now: () => NOW,
		})();
		expect(await run({})).toEqual({ deleted: 0 });
		await expect(run({ Contents: [{}] })).rejects.toThrow("unexpected raw-import listing");
		await expect(run({ Contents: [{ Key: ISSUE }] })).rejects.toThrow("unexpected raw-import listing");
		await expect(run({ IsTruncated: true })).rejects.toThrow("missing continuation token");
	});

	it("removes expired, legacy and orphaned captures across pages, retries a partial failure, and preserves saved bodies", async () => {
		const h = harness();
		await expect(h.run()).rejects.toThrow("failed to delete 1 objects");
		expect([...h.contents.keys()].sort()).toEqual([`${RAW}first.eml`, `${RAW}later.eml`, ISSUE, "inbound/forwarded"].sort());
		h.recover();
		expect(await h.run()).toEqual({ deleted: 1 });
		h.advance(40 * DAY);
		expect(await h.run()).toEqual({ deleted: 1 });
		expect(await h.run()).toEqual({ deleted: 0 });
		expect(h.contents.get(ISSUE)).toBe("<p>Saved synthetic issue</p>");
		expect(h.contents.get("inbound/forwarded")).toBe("forwarded");
	});
});
