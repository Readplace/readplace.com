import { NoSuchKey, S3ServiceException, type S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initResolveAuthoredContentKeys } from "./resolve-authored-content-keys";

/**
 * 1. The SDK clients' `send` are heavily-overloaded generics the test fakes
 *    cannot structurally satisfy; the contained casts are the isolated
 *    SDK-wrapper exception in CLAUDE.md "Avoid TypeScript Type Assertions".
 */
function createFakeDynamo(item: Record<string, unknown> | undefined): DynamoDBDocumentClient {
	const send = async () => ({ Item: item });
	return { send } as unknown as DynamoDBDocumentClient /* 1 */;
}

type FakeSidecar =
	| { body: string }
	| "missing"
	| "missing-as-service-exception"
	| "empty-body"
	| { failure: Error };

function createFakeS3(
	sidecar: FakeSidecar,
	capture?: (input: Record<string, unknown>) => void,
): Pick<S3Client, "send"> {
	const send = async (command: { input: Record<string, unknown> }) => {
		capture?.(command.input);
		if (sidecar === "missing") {
			throw new NoSuchKey({ $metadata: {}, message: "no such key" });
		}
		if (sidecar === "missing-as-service-exception") {
			throw new S3ServiceException({
				name: "NoSuchKey",
				$fault: "client",
				$metadata: {},
			});
		}
		if (sidecar === "empty-body") {
			return {};
		}
		if ("failure" in sidecar) {
			throw sidecar.failure;
		}
		return {
			Body: { transformToString: async () => sidecar.body },
		};
	};
	return { send } as unknown as Pick<S3Client, "send"> /* 1 */;
}

const TABLE = "articles";
const BUCKET = "content-bucket";
const URL = "https://example.com/post";
const ENCODED = "example.com%2Fpost";
const ONLY_AUTHORED = "2026-07-10T09:41Z";
const ONLY_AUTHORED_KEY = `content-versions/${ENCODED}/2026-07-10T09-41Z/content.html`;
const lastAuthoredRequest = {
	url: URL,
	userId: "user-1",
	versionMinuteId: ONLY_AUTHORED,
};

function createResolver(opts: {
	crawlVersions?: unknown[];
	sidecar: FakeSidecar;
	captureS3?: (input: Record<string, unknown>) => void;
}) {
	return initResolveAuthoredContentKeys({
		s3Client: createFakeS3(opts.sidecar, opts.captureS3),
		dynamoClient: createFakeDynamo(
			opts.crawlVersions === undefined ? {} : { crawlVersions: opts.crawlVersions },
		),
		tableName: TABLE,
		bucketName: BUCKET,
	});
}

describe("initResolveAuthoredContentKeys", () => {
	it("the last snapshot a user authored takes their tier-0 capture and its sidecar with it", async () => {
		const s3Inputs: Record<string, unknown>[] = [];
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [
				{ minuteId: "2026-07-10T09:41Z", authorUserId: "user-1" },
				{ minuteId: "2026-06-28T22:01Z", authorUserId: "user-2" },
				"2026-03-26T14:32Z",
			],
			sidecar: { body: JSON.stringify({ title: "T", authorUserId: "user-1" }) },
			captureS3: (input) => s3Inputs.push(input),
		});

		const resolved = await resolveAuthoredContentKeys({
			url: URL,
			userId: "user-1",
			versionMinuteId: "2026-07-10T09:41Z",
		});

		expect(resolved.objectKeys).toEqual([
			`content-versions/${ENCODED}/2026-07-10T09-41Z/content.html`,
			`articles/${ENCODED}/sources/tier-0.html`,
			`articles/${ENCODED}/sources/tier-0.metadata.json`,
		]);
		expect(resolved.pruneMinuteIds).toEqual(["2026-07-10T09:41Z"]);
		expect(s3Inputs).toEqual([
			{ Bucket: BUCKET, Key: `articles/${ENCODED}/sources/tier-0.metadata.json` },
		]);
	});

	it("one of several authored snapshots resolves alone, leaving the capture its siblings still need", async () => {
		const s3Inputs: Record<string, unknown>[] = [];
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [
				{ minuteId: "2026-07-10T09:41Z", authorUserId: "user-1" },
				{ minuteId: "2026-06-28T22:01Z", authorUserId: "user-1" },
				{ minuteId: "2026-03-26T14:32Z", authorUserId: "user-1" },
			],
			sidecar: { body: JSON.stringify({ authorUserId: "user-1" }) },
			captureS3: (input) => s3Inputs.push(input),
		});

		const resolved = await resolveAuthoredContentKeys({
			url: URL,
			userId: "user-1",
			versionMinuteId: "2026-06-28T22:01Z",
		});

		expect(resolved.objectKeys).toEqual([
			`content-versions/${ENCODED}/2026-06-28T22-01Z/content.html`,
		]);
		expect(resolved.pruneMinuteIds).toEqual(["2026-06-28T22:01Z"]);
		expect(s3Inputs).toEqual([]);
	});

	it("keeps the capture when the sole authored snapshot is not the one named", async () => {
		const s3Inputs: Record<string, unknown>[] = [];
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [
				{ minuteId: "2026-06-28T22:01Z", authorUserId: "user-1" },
				{ minuteId: ONLY_AUTHORED, authorUserId: "user-2" },
			],
			sidecar: { body: JSON.stringify({ authorUserId: "user-1" }) },
			captureS3: (input) => s3Inputs.push(input),
		});

		const resolved = await resolveAuthoredContentKeys(lastAuthoredRequest);

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [] });
		expect(s3Inputs).toEqual([]);
	});

	it("keeps a tier-0 capture the sidecar credits to someone else", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: "2026-07-10T09:41Z", authorUserId: "user-1" }],
			sidecar: { body: JSON.stringify({ authorUserId: "user-2" }) },
		});

		const resolved = await resolveAuthoredContentKeys({
			url: URL,
			userId: "user-1",
			versionMinuteId: "2026-07-10T09:41Z",
		});

		expect(resolved.objectKeys).toEqual([
			`content-versions/${ENCODED}/2026-07-10T09-41Z/content.html`,
		]);
		expect(resolved.pruneMinuteIds).toEqual(["2026-07-10T09:41Z"]);
	});

	it("a snapshot someone else authored resolves to nothing and never reads the sidecar", async () => {
		const s3Inputs: Record<string, unknown>[] = [];
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: "2026-07-10T09:41Z", authorUserId: "user-2" }],
			sidecar: { body: JSON.stringify({ authorUserId: "user-1" }) },
			captureS3: (input) => s3Inputs.push(input),
		});

		const resolved = await resolveAuthoredContentKeys({
			url: URL,
			userId: "user-1",
			versionMinuteId: "2026-07-10T09:41Z",
		});

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [] });
		expect(s3Inputs).toEqual([]);
	});

	it("counts only attributed entries as the user's, so a legacy authorless log leaves the capture", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: ["2026-03-26T14:32Z"],
			sidecar: { body: JSON.stringify({ authorUserId: "user-1" }) },
		});

		const resolved = await resolveAuthoredContentKeys({
			url: URL,
			userId: "user-1",
			versionMinuteId: "2026-03-26T14:32Z",
		});

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [] });
	});

	it("treats a missing tier-0 sidecar as unauthored", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: ONLY_AUTHORED, authorUserId: "user-1" }],
			sidecar: "missing",
		});

		const resolved = await resolveAuthoredContentKeys(lastAuthoredRequest);

		expect(resolved).toEqual({
			objectKeys: [ONLY_AUTHORED_KEY],
			pruneMinuteIds: [ONLY_AUTHORED],
		});
	});

	it("treats a sidecar with a non-string author field as unauthored", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: ONLY_AUTHORED, authorUserId: "user-1" }],
			sidecar: { body: JSON.stringify({ authorUserId: 42 }) },
		});

		const resolved = await resolveAuthoredContentKeys(lastAuthoredRequest);

		expect(resolved).toEqual({
			objectKeys: [ONLY_AUTHORED_KEY],
			pruneMinuteIds: [ONLY_AUTHORED],
		});
	});

	it("resolves nothing for a row with no crawlVersions attribute", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			sidecar: "missing",
		});

		const resolved = await resolveAuthoredContentKeys(lastAuthoredRequest);

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [] });
	});

	it("treats S3's alternate NoSuchKey encoding (S3ServiceException) as a missing sidecar", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: ONLY_AUTHORED, authorUserId: "user-1" }],
			sidecar: "missing-as-service-exception",
		});

		const resolved = await resolveAuthoredContentKeys(lastAuthoredRequest);

		expect(resolved).toEqual({
			objectKeys: [ONLY_AUTHORED_KEY],
			pruneMinuteIds: [ONLY_AUTHORED],
		});
	});

	it("treats a sidecar response without a body as unauthored", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: ONLY_AUTHORED, authorUserId: "user-1" }],
			sidecar: "empty-body",
		});

		const resolved = await resolveAuthoredContentKeys(lastAuthoredRequest);

		expect(resolved).toEqual({
			objectKeys: [ONLY_AUTHORED_KEY],
			pruneMinuteIds: [ONLY_AUTHORED],
		});
	});

	it("treats a sidecar holding malformed JSON as unauthored instead of redelivering forever", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: ONLY_AUTHORED, authorUserId: "user-1" }],
			sidecar: { body: "{truncated" },
		});

		const resolved = await resolveAuthoredContentKeys(lastAuthoredRequest);

		expect(resolved).toEqual({
			objectKeys: [ONLY_AUTHORED_KEY],
			pruneMinuteIds: [ONLY_AUTHORED],
		});
	});

	it("rethrows genuine S3 failures so the command redelivers", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: ONLY_AUTHORED, authorUserId: "user-1" }],
			sidecar: { failure: new Error("access denied") },
		});

		await expect(resolveAuthoredContentKeys(lastAuthoredRequest)).rejects.toThrow(
			"access denied",
		);
	});
});
