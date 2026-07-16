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
	it("whole-copy scope: resolves the authored snapshots plus the authored tier-0 pair", async () => {
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

		const resolved = await resolveAuthoredContentKeys({ url: URL, userId: "user-1" });

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

	it("whole-copy scope: keeps another user's tier-0 capture and legacy authorless snapshots", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: ["2026-03-26T14:32Z"],
			sidecar: { body: JSON.stringify({ authorUserId: "user-2" }) },
		});

		const resolved = await resolveAuthoredContentKeys({ url: URL, userId: "user-1" });

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [] });
	});

	it("version scope: resolves only the named snapshot when the viewer authored it, never the tier-0 pair", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [
				{ minuteId: "2026-07-10T09:41Z", authorUserId: "user-1" },
				{ minuteId: "2026-06-28T22:01Z", authorUserId: "user-1" },
			],
			sidecar: { body: JSON.stringify({ authorUserId: "user-1" }) },
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
	});

	it("version scope: a snapshot someone else authored resolves to nothing", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: "2026-07-10T09:41Z", authorUserId: "user-2" }],
			sidecar: { body: JSON.stringify({ authorUserId: "user-2" }) },
		});

		const resolved = await resolveAuthoredContentKeys({
			url: URL,
			userId: "user-1",
			versionMinuteId: "2026-07-10T09:41Z",
		});

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [] });
	});

	it("treats a missing tier-0 sidecar as unauthored", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [],
			sidecar: "missing",
		});

		const resolved = await resolveAuthoredContentKeys({ url: URL, userId: "user-1" });

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [] });
	});

	it("treats a sidecar with a non-string author field as unauthored", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [],
			sidecar: { body: JSON.stringify({ authorUserId: 42 }) },
		});

		const resolved = await resolveAuthoredContentKeys({ url: URL, userId: "user-1" });

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [] });
	});

	it("resolves nothing for a row with no crawlVersions attribute", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			sidecar: "missing",
		});

		const resolved = await resolveAuthoredContentKeys({ url: URL, userId: "user-1" });

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [] });
	});

	it("treats S3's alternate NoSuchKey encoding (S3ServiceException) as a missing sidecar", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [],
			sidecar: "missing-as-service-exception",
		});

		const resolved = await resolveAuthoredContentKeys({ url: URL, userId: "user-1" });

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [] });
	});

	it("treats a sidecar response without a body as unauthored", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [],
			sidecar: "empty-body",
		});

		const resolved = await resolveAuthoredContentKeys({ url: URL, userId: "user-1" });

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [] });
	});

	it("treats a sidecar holding malformed JSON as unauthored instead of redelivering forever", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [],
			sidecar: { body: "{truncated" },
		});

		const resolved = await resolveAuthoredContentKeys({ url: URL, userId: "user-1" });

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [] });
	});

	it("rethrows genuine S3 failures so the command redelivers", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [],
			sidecar: { failure: new Error("access denied") },
		});

		await expect(
			resolveAuthoredContentKeys({ url: URL, userId: "user-1" }),
		).rejects.toThrow("access denied");
	});
});
