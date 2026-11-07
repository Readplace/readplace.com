import { NoSuchKey, S3ServiceException, type S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { toEventInstant } from "@packages/domain/event-envelope";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
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
	| { body: string; lastModified?: Date }
	| "missing"
	| "missing-as-service-exception"
	| "empty-body"
	| { failure: Error };

function createFakeS3(
	sidecar: FakeSidecar,
	capture?: (input: Record<string, unknown>) => void,
	objects: Record<string, FakeSidecar> = {},
): Pick<S3Client, "send"> {
	const send = async (command: { input: Record<string, unknown> }) => {
		capture?.(command.input);
		const object = objects[String(command.input.Key)] ?? sidecar;
		if (object === "missing") {
			throw new NoSuchKey({ $metadata: {}, message: "no such key" });
		}
		if (object === "missing-as-service-exception") {
			throw new S3ServiceException({
				name: "NoSuchKey",
				$fault: "client",
				$metadata: {},
			});
		}
		if (object === "empty-body") {
			return {};
		}
		if ("failure" in object) {
			throw object.failure;
		}
		return {
			Body: { transformToString: async () => object.body },
			LastModified: object.lastModified ?? STORED_AT,
		};
	};
	return { send } as unknown as Pick<S3Client, "send"> /* 1 */;
}

const STORED_AT = new Date("2026-07-10T09:41:30Z");
const REQUESTED_AT = toEventInstant(new Date("2026-07-10T10:00:00Z"));
const TABLE = "articles";
const BUCKET = "content-bucket";
const URL = "https://example.com/post";
const ENCODED = "example.com%2Fpost";
const ONLY_AUTHORED = "2026-07-10T09:41Z";
const ONLY_AUTHORED_KEY = `content-versions/${ENCODED}/2026-07-10T09-41Z/content.html`;
const CANDIDATE_PREFIX = `articles/${ENCODED}/sources/tier-0.html.candidates/`;
const lastAuthoredRequest = {
	url: URL,
	userId: "user-1",
	versionMinuteId: ONLY_AUTHORED,
	requestedAt: REQUESTED_AT,
};

function createResolver(opts: {
	crawlVersions?: unknown[];
	sidecar: FakeSidecar;
	captureS3?: (input: Record<string, unknown>) => void;
	objects?: Record<string, FakeSidecar>;
	listContentKeys?: (prefix: string) => Promise<string[]>;
}) {
	return initResolveAuthoredContentKeys({
		s3Client: createFakeS3(opts.sidecar, opts.captureS3, opts.objects),
		dynamoClient: createFakeDynamo(
			opts.crawlVersions === undefined ? {} : { crawlVersions: opts.crawlVersions },
		),
		tableName: TABLE,
		bucketName: BUCKET,
		listContentKeys: opts.listContentKeys ?? (async () => []),
	});
}

function authoredCandidate({ id, authorUserId, fetchedAt }: { id: string; authorUserId?: string; fetchedAt?: string }) {
	const manifestKey = `${CANDIDATE_PREFIX}${createHash("sha256").update(id).digest("hex")}/metadata.json`;
	const bodyPrefix = `${CANDIDATE_PREFIX}${createHash("sha256").update(`body:${id}`).digest("hex")}/`;
	const metadata = { id, authorUserId, fetchedAt, htmlLocation: `${bodyPrefix}content.html`, evaluationLocation: `${bodyPrefix}evaluation.html` };
	return { manifestKey, metadata, object: { body: JSON.stringify(metadata) } };
}

describe("initResolveAuthoredContentKeys", () => {
	it("removes every historical immutable capture credited to the last snapshot's author", async () => {
		const earlier = authoredCandidate({ id: "earlier", authorUserId: "user-1" });
		const latest = authoredCandidate({ id: "latest", authorUserId: "user-1" });
		const other = authoredCandidate({ id: "other", authorUserId: "user-2" });
		const unknown = authoredCandidate({ id: "unknown" });
		const objects = Object.fromEntries([earlier, latest, other, unknown].map((candidate) => [candidate.manifestKey, candidate.object]));
		const prefixes: string[] = [];
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: ONLY_AUTHORED, authorUserId: "user-1" }],
			sidecar: other.object,
			objects,
			listContentKeys: async (prefix) => { prefixes.push(prefix); return [...Object.keys(objects), latest.metadata.htmlLocation]; },
		});

		const resolved = await resolveAuthoredContentKeys(lastAuthoredRequest);

		expect(prefixes).toEqual([CANDIDATE_PREFIX, `articles/${ENCODED}/sources/media-owners/`]);
		expect(resolved.objectKeys).toEqual([
			ONLY_AUTHORED_KEY,
			earlier.metadata.htmlLocation, earlier.metadata.evaluationLocation,
			latest.metadata.htmlLocation, latest.metadata.evaluationLocation,
		]);
		expect(resolved.pruneMinuteIds).toEqual([ONLY_AUTHORED]);
		expect(resolved.candidateIds).toEqual([earlier.metadata.id, latest.metadata.id]);
		expect(resolved.manifestKeys).toEqual([earlier.manifestKey, latest.manifestKey]);
	});

	it("finishes deleting immutable captures on redelivery after the authored version was already pruned", async () => {
		const candidate = authoredCandidate({ id: "left-after-prune", authorUserId: "user-1" });
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: ONLY_AUTHORED, authorUserId: "user-2" }],
			sidecar: "missing",
			objects: { [candidate.manifestKey]: candidate.object },
			listContentKeys: async () => [candidate.manifestKey],
		});

		expect(await resolveAuthoredContentKeys(lastAuthoredRequest)).toEqual({
			objectKeys: [candidate.metadata.htmlLocation, candidate.metadata.evaluationLocation],
			manifestKeys: [candidate.manifestKey],
			pruneMinuteIds: [],
			candidateIds: [candidate.metadata.id],
		});
	});

	it("retains immutable captures while another snapshot attributed to that author remains", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [
				{ minuteId: ONLY_AUTHORED, authorUserId: "user-1" },
				{ minuteId: "2026-06-28T22:01Z", authorUserId: "user-1" },
			],
			sidecar: "missing",
			listContentKeys: async () => { throw new Error("remaining authored version must retain its candidate sources"); },
		});

		expect(await resolveAuthoredContentKeys(lastAuthoredRequest)).toEqual({
			objectKeys: [ONLY_AUTHORED_KEY], pruneMinuteIds: [ONLY_AUTHORED], candidateIds: [], manifestKeys: [],
		});
	});

	it("preserves candidates whose manifest is missing or malformed and ignores listing entries that are not manifests", async () => {
		const missing = authoredCandidate({ id: "missing", authorUserId: "user-1" });
		const malformed = authoredCandidate({ id: "malformed", authorUserId: "user-1" });
		const objects: Record<string, FakeSidecar> = {
			[missing.manifestKey]: "missing",
			[malformed.manifestKey]: { body: "{truncated" },
		};
		const reads: Record<string, unknown>[] = [];
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [], sidecar: "missing", objects, captureS3: (input) => reads.push(input),
			listContentKeys: async () => [...Object.keys(objects), `${CANDIDATE_PREFIX}not-a-hash/metadata.json`],
		});

		expect(await resolveAuthoredContentKeys(lastAuthoredRequest)).toEqual({ objectKeys: [], pruneMinuteIds: [], candidateIds: [], manifestKeys: [] });
		expect(reads.map((input) => input.Key)).toEqual(Object.keys(objects));
	});

	it("rethrows listing and immutable manifest access errors so erasure can retry", async () => {
		const candidate = authoredCandidate({ id: "denied", authorUserId: "user-1" });
		const denied = createResolver({
			crawlVersions: [], sidecar: "missing",
			objects: { [candidate.manifestKey]: { failure: new Error("access denied") } },
			listContentKeys: async () => [candidate.manifestKey],
		});
		await expect(denied.resolveAuthoredContentKeys(lastAuthoredRequest)).rejects.toThrow("access denied");
		const failedList = createResolver({
			crawlVersions: [], sidecar: "missing",
			listContentKeys: async () => { throw new Error("listing failed"); },
		});
		await expect(failedList.resolveAuthoredContentKeys(lastAuthoredRequest)).rejects.toThrow("listing failed");
	});

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
			requestedAt: REQUESTED_AT,
		});

		expect(resolved.objectKeys).toEqual([
			`content-versions/${ENCODED}/2026-07-10T09-41Z/content.html`,
			`articles/${ENCODED}/sources/tier-0.html`,
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
			requestedAt: REQUESTED_AT,
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

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [], candidateIds: [], manifestKeys: [] });
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
			requestedAt: REQUESTED_AT,
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
			requestedAt: REQUESTED_AT,
		});

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [], candidateIds: [], manifestKeys: [] });
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
			requestedAt: REQUESTED_AT,
		});

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [], candidateIds: [], manifestKeys: [] });
	});

	it("treats a missing tier-0 sidecar as unauthored", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: ONLY_AUTHORED, authorUserId: "user-1" }],
			sidecar: "missing",
		});

		const resolved = await resolveAuthoredContentKeys(lastAuthoredRequest);

		expect(resolved).toEqual({
			objectKeys: [ONLY_AUTHORED_KEY],
			pruneMinuteIds: [ONLY_AUTHORED], candidateIds: [], manifestKeys: [],
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
			pruneMinuteIds: [ONLY_AUTHORED], candidateIds: [], manifestKeys: [],
		});
	});

	it("resolves nothing for a row with no crawlVersions attribute", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			sidecar: "missing",
		});

		const resolved = await resolveAuthoredContentKeys(lastAuthoredRequest);

		expect(resolved).toEqual({ objectKeys: [], pruneMinuteIds: [], candidateIds: [], manifestKeys: [] });
	});

	it("treats S3's alternate NoSuchKey encoding (S3ServiceException) as a missing sidecar", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: ONLY_AUTHORED, authorUserId: "user-1" }],
			sidecar: "missing-as-service-exception",
		});

		const resolved = await resolveAuthoredContentKeys(lastAuthoredRequest);

		expect(resolved).toEqual({
			objectKeys: [ONLY_AUTHORED_KEY],
			pruneMinuteIds: [ONLY_AUTHORED], candidateIds: [], manifestKeys: [],
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
			pruneMinuteIds: [ONLY_AUTHORED], candidateIds: [], manifestKeys: [],
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
			pruneMinuteIds: [ONLY_AUTHORED], candidateIds: [], manifestKeys: [],
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

it("revokes candidates from immutable manifests and candidate-backed history without inventing a dated S3 copy", async () => {
	const candidate = authoredCandidate({ id: "owned", authorUserId: "user-1" });
	const { resolveAuthoredContentKeys } = createResolver({
		crawlVersions: [{ minuteId: ONLY_AUTHORED, authorUserId: "user-1", candidateId: "history-candidate" }],
		sidecar: "missing",
		objects: { [candidate.manifestKey]: candidate.object },
		listContentKeys: async () => [candidate.manifestKey],
	});
	const result = await resolveAuthoredContentKeys(lastAuthoredRequest);
	expect(result.objectKeys).toEqual([candidate.metadata.htmlLocation, candidate.metadata.evaluationLocation]);
	expect(result.manifestKeys).toEqual([candidate.manifestKey]);
	expect(result.candidateIds).toEqual(["owned", "history-candidate"]);
});

function authoredMedia({ attemptId, authorUserId, digests = { scope: 64, body: 64 } }: { attemptId: string; authorUserId?: string; digests?: { scope: number; body: number } }) {
	const scope = createHash("sha256").update(JSON.stringify([attemptId, authorUserId ?? null])).digest("hex").slice(0, digests.scope);
	const name = `${scope}/${"a".repeat(digests.body)}.png`;
	const objectKey = `content/${ENCODED}/images/attempts/${name}`;
	const metadata = { url: URL, attemptId, authorUserId, objectKey };
	return { objectKey, manifestKey: `articles/${ENCODED}/sources/media-owners/${name}.metadata.json`, metadata, object: { body: JSON.stringify(metadata) } };
}

it("erases owned media named with either the full or the truncated digests and skips every other name shape", async () => {
	const full = authoredMedia({ attemptId: "full", authorUserId: "user-1" });
	const truncated = authoredMedia({ attemptId: "truncated", authorUserId: "user-1", digests: { scope: 32, body: 32 } });
	const misshapen = [{ scope: 64, body: 32 }, { scope: 32, body: 64 }, { scope: 36, body: 36 }].map((digests) => authoredMedia({ attemptId: `misshapen-${digests.scope}-${digests.body}`, authorUserId: "user-1", digests }));
	const objects = Object.fromEntries([full, truncated, ...misshapen].map((entry) => [entry.manifestKey, entry.object]));
	const { resolveAuthoredContentKeys } = createResolver({ sidecar: "missing", objects, listContentKeys: async () => Object.keys(objects) });
	expect(await resolveAuthoredContentKeys(lastAuthoredRequest)).toEqual({ objectKeys: [full.objectKey, truncated.objectKey], manifestKeys: [full.manifestKey, truncated.manifestKey], candidateIds: [], pruneMinuteIds: [] });
});

it("erases owned media while preserving other and unknown ownership", async () => {
	const own = authoredMedia({ attemptId: "owned", authorUserId: "user-1" });
	const other = authoredMedia({ attemptId: "other", authorUserId: "user-2" });
	const unknown = authoredMedia({ attemptId: "unknown" });
	const objects = Object.fromEntries([own, other, unknown].map((entry) => [entry.manifestKey, entry.object]));
	const { resolveAuthoredContentKeys } = createResolver({
		sidecar: "missing", objects,
		listContentKeys: async () => [...Object.keys(objects), own.objectKey],
	});
	expect(await resolveAuthoredContentKeys(lastAuthoredRequest)).toEqual({ objectKeys: [own.objectKey], manifestKeys: [own.manifestKey], candidateIds: [], pruneMinuteIds: [] });
});

it("removes owned media and preserves media whose manifest is malformed", async () => {
	const own = authoredMedia({ attemptId: "owned", authorUserId: "user-1" });
	const malformed = authoredMedia({ attemptId: "malformed", authorUserId: "user-1" });
	const objects = {
		[own.manifestKey]: own.object,
		[malformed.manifestKey]: { body: "{}" },
	};
	const { resolveAuthoredContentKeys } = createResolver({ sidecar: "missing", objects, listContentKeys: async () => Object.keys(objects) });
	expect(await resolveAuthoredContentKeys(lastAuthoredRequest)).toEqual({ objectKeys: [own.objectKey], manifestKeys: [own.manifestKey], candidateIds: [], pruneMinuteIds: [] });
});

it("resolves no history for an absent row", async () => {
	const { resolveAuthoredContentKeys } = initResolveAuthoredContentKeys({ s3Client: createFakeS3("missing"), dynamoClient: createFakeDynamo(undefined), tableName: TABLE, bucketName: BUCKET, listContentKeys: async () => [] });
	expect(await resolveAuthoredContentKeys(lastAuthoredRequest)).toEqual({ objectKeys: [], manifestKeys: [], pruneMinuteIds: [], candidateIds: [] });
});

it.each(["first", "second"] as const)("removing the %s of two candidate-backed authored versions erases only its candidate", async (removed) => {
	const versions = {
		first: { minuteId: "2026-06-28T22:01Z", candidate: authoredCandidate({ id: "first-capture", authorUserId: "user-1" }) },
		second: { minuteId: ONLY_AUTHORED, candidate: authoredCandidate({ id: "second-capture", authorUserId: "user-1" }) },
	};
	const objects = Object.fromEntries(Object.values(versions).map(({ candidate }) => [candidate.manifestKey, candidate.object]));
	const { resolveAuthoredContentKeys } = createResolver({
		crawlVersions: Object.values(versions).map(({ minuteId, candidate }) => ({ minuteId, authorUserId: "user-1", candidateId: candidate.metadata.id })),
		sidecar: "missing",
		objects,
		listContentKeys: async () => Object.keys(objects),
	});

	const { candidate } = versions[removed];
	expect(await resolveAuthoredContentKeys({ url: URL, userId: "user-1", versionMinuteId: versions[removed].minuteId, requestedAt: REQUESTED_AT })).toEqual({
		objectKeys: [candidate.metadata.htmlLocation, candidate.metadata.evaluationLocation],
		manifestKeys: [candidate.manifestKey],
		pruneMinuteIds: [versions[removed].minuteId],
		candidateIds: [candidate.metadata.id],
	});
});

it("keeps a candidate a remaining authored version still references", async () => {
	const shared = authoredCandidate({ id: "shared-capture", authorUserId: "user-1" });
	const { resolveAuthoredContentKeys } = createResolver({
		crawlVersions: [ONLY_AUTHORED, "2026-06-28T22:01Z"].map((minuteId) => ({ minuteId, authorUserId: "user-1", candidateId: shared.metadata.id })),
		sidecar: "missing",
		listContentKeys: async () => { throw new Error("a still-referenced candidate must not be listed for erasure"); },
	});

	expect(await resolveAuthoredContentKeys(lastAuthoredRequest)).toEqual({ objectKeys: [], manifestKeys: [], pruneMinuteIds: [ONLY_AUTHORED], candidateIds: [] });
});

describe("the removal resolves against the state as of the request", () => {
	const AFTER_REQUEST = "2026-07-10T10:00:01.000Z";
	const BEFORE_REQUEST = "2026-07-10T09:59:59.000Z";

	it("keeps a capture saved after the request when the log is empty", async () => {
		const earlier = authoredCandidate({ id: "earlier", authorUserId: "user-1", fetchedAt: BEFORE_REQUEST });
		const later = authoredCandidate({ id: "later", authorUserId: "user-1", fetchedAt: AFTER_REQUEST });
		const objects = Object.fromEntries([earlier, later].map((candidate) => [candidate.manifestKey, candidate.object]));
		const { resolveAuthoredContentKeys } = createResolver({ crawlVersions: [], sidecar: "missing", objects, listContentKeys: async () => Object.keys(objects) });

		expect(await resolveAuthoredContentKeys(lastAuthoredRequest)).toEqual({
			objectKeys: [earlier.metadata.htmlLocation, earlier.metadata.evaluationLocation],
			manifestKeys: [earlier.manifestKey],
			pruneMinuteIds: [],
			candidateIds: [earlier.metadata.id],
		});
	});

	it("keeps a capture saved after the request when the named version is the last one", async () => {
		const earlier = authoredCandidate({ id: "earlier", authorUserId: "user-1", fetchedAt: BEFORE_REQUEST });
		const later = authoredCandidate({ id: "later", authorUserId: "user-1", fetchedAt: AFTER_REQUEST });
		const objects = Object.fromEntries([earlier, later].map((candidate) => [candidate.manifestKey, candidate.object]));
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: ONLY_AUTHORED, authorUserId: "user-1" }],
			sidecar: "missing", objects, listContentKeys: async () => Object.keys(objects),
		});

		expect(await resolveAuthoredContentKeys(lastAuthoredRequest)).toEqual({
			objectKeys: [ONLY_AUTHORED_KEY, earlier.metadata.htmlLocation, earlier.metadata.evaluationLocation],
			manifestKeys: [earlier.manifestKey],
			pruneMinuteIds: [ONLY_AUTHORED],
			candidateIds: [earlier.metadata.id],
		});
	});

	it("counts only versions logged by the request minute as the reader's", async () => {
		const earlier = authoredCandidate({ id: "earlier", authorUserId: "user-1", fetchedAt: BEFORE_REQUEST });
		const later = authoredCandidate({ id: "later", authorUserId: "user-1", fetchedAt: AFTER_REQUEST });
		const objects = Object.fromEntries([earlier, later].map((candidate) => [candidate.manifestKey, candidate.object]));
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [
				{ minuteId: ONLY_AUTHORED, authorUserId: "user-1" },
				{ minuteId: "2026-07-10T10:01Z", authorUserId: "user-1", candidateId: later.metadata.id },
			],
			sidecar: "missing", objects, listContentKeys: async () => Object.keys(objects),
		});

		expect(await resolveAuthoredContentKeys(lastAuthoredRequest)).toEqual({
			objectKeys: [ONLY_AUTHORED_KEY, earlier.metadata.htmlLocation, earlier.metadata.evaluationLocation],
			manifestKeys: [earlier.manifestKey],
			pruneMinuteIds: [ONLY_AUTHORED],
			candidateIds: [earlier.metadata.id],
		});
	});

	it("keeps a tier-0 sidecar a later capture rewrote", async () => {
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: ONLY_AUTHORED, authorUserId: "user-1" }],
			sidecar: { body: JSON.stringify({ authorUserId: "user-1", fetchedAt: AFTER_REQUEST }) },
		});

		expect(await resolveAuthoredContentKeys(lastAuthoredRequest)).toEqual({
			objectKeys: [ONLY_AUTHORED_KEY], manifestKeys: [], pruneMinuteIds: [ONLY_AUTHORED], candidateIds: [],
		});
	});

	it("erases media whose owner manifest predates the request and keeps a later one", async () => {
		const earlier = authoredMedia({ attemptId: "earlier", authorUserId: "user-1" });
		const later = authoredMedia({ attemptId: "later", authorUserId: "user-1" });
		const objects = {
			[earlier.manifestKey]: { ...earlier.object, lastModified: new Date(BEFORE_REQUEST) },
			[later.manifestKey]: { ...later.object, lastModified: new Date(AFTER_REQUEST) },
		};
		const { resolveAuthoredContentKeys } = createResolver({ sidecar: "missing", objects, listContentKeys: async () => Object.keys(objects) });

		expect(await resolveAuthoredContentKeys(lastAuthoredRequest)).toEqual({ objectKeys: [earlier.objectKey], manifestKeys: [earlier.manifestKey], candidateIds: [], pruneMinuteIds: [] });
	});

	it("treats a capture in the same second as the request as before it", async () => {
		const sameSecond = authoredCandidate({ id: "same-second", authorUserId: "user-1", fetchedAt: "2026-07-10T10:00:00.999Z" });
		const media = authoredMedia({ attemptId: "same-second", authorUserId: "user-1" });
		const objects = {
			[sameSecond.manifestKey]: sameSecond.object,
			[media.manifestKey]: { ...media.object, lastModified: new Date("2026-07-10T10:00:00.500Z") },
		};
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [{ minuteId: ONLY_AUTHORED, authorUserId: "user-1" }],
			sidecar: { body: JSON.stringify({ authorUserId: "user-1", fetchedAt: "2026-07-10T10:00:00Z" }) },
			objects, listContentKeys: async () => Object.keys(objects),
		});

		expect(await resolveAuthoredContentKeys(lastAuthoredRequest)).toEqual({
			objectKeys: [ONLY_AUTHORED_KEY, `articles/${ENCODED}/sources/tier-0.html`, media.objectKey, sameSecond.metadata.htmlLocation, sameSecond.metadata.evaluationLocation],
			manifestKeys: [`articles/${ENCODED}/sources/tier-0.metadata.json`, media.manifestKey, sameSecond.manifestKey],
			pruneMinuteIds: [ONLY_AUTHORED],
			candidateIds: [sameSecond.metadata.id],
		});
	});

	it("treats a manifest with an unparseable fetchedAt as before the request", async () => {
		const unparseable = authoredCandidate({ id: "unparseable", authorUserId: "user-1", fetchedAt: "not a time" });
		const { resolveAuthoredContentKeys } = createResolver({
			crawlVersions: [], sidecar: "missing",
			objects: { [unparseable.manifestKey]: unparseable.object },
			listContentKeys: async () => [unparseable.manifestKey],
		});

		expect(await resolveAuthoredContentKeys(lastAuthoredRequest)).toEqual({
			objectKeys: [unparseable.metadata.htmlLocation, unparseable.metadata.evaluationLocation],
			manifestKeys: [unparseable.manifestKey],
			pruneMinuteIds: [],
			candidateIds: [unparseable.metadata.id],
		});
	});
});
