import { CandidateIdSchema, SaveAttemptIdSchema } from "@packages/domain/article";
import assert from "node:assert/strict";
import { NoSuchKey, S3ServiceException, type S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { noopLogger } from "@packages/hutch-logger";
import { initPutTierSource } from "./put-tier-source";
import { initReadTierSource } from "./read-tier-source";
import { initWriteCanonicalContent } from "./promote-tier-to-canonical";
import { initPersistCandidateArtifact } from "./persist-candidate-artifact";
import { candidateBodyKeys, candidateManifestKey } from "./candidate-object-keys";
import { CandidateProvenanceSchema, type CandidateProvenance } from "../../domain/select-content/tier-source.types";
import { candidateProvenance } from "../../domain/select-content/candidate-provenance";

const cid = (id: string) => CandidateIdSchema.parse(id);

const URL = "https://example.com/post";
const HTML = '<p>Private capture<img src="https://example.com/photo.jpg"></p>';
const params = {
	url: URL, tier: "tier-0" as const, html: HTML, evaluationHtml: HTML,
	metadata: candidateProvenance({ metadata: { title: "Title", siteName: "Site", excerpt: "", wordCount: 3, estimatedReadTime: 1, authorUserId: "alice" }, html: HTML, evaluationHtml: HTML, attemptId: SaveAttemptIdSchema.parse("attempt"), originalUrl: URL, sourceUrl: URL, kind: "extension", fetchedAt: "2026-10-01T00:00:00.000Z" }),
};
const CommandSchema = z.object({ input: z.object({ Key: z.string(), Body: z.string().optional(), IfNoneMatch: z.string().optional() }) });
function storage(before: (input: z.infer<typeof CommandSchema>["input"]) => void = () => {}) {
	const objects = new Map<string, string>();
	const send = async (command: unknown) => {
		const input = CommandSchema.parse(command).input;
		before(input);
		const { Key, Body, IfNoneMatch } = input;
		if (Body !== undefined) {
			if (IfNoneMatch === "*" && objects.has(Key)) throw new S3ServiceException({ name: "PreconditionFailed", $fault: "client", $metadata: { httpStatusCode: 412 }, message: "already exists" });
			objects.set(Key, Body); return {};
		}
		const body = objects.get(Key);
		if (body === undefined) throw new NoSuchKey({ $metadata: {}, message: "missing" });
		return { Body: { transformToString: async () => body } };
	};
	const client = { send } as unknown as Pick<S3Client, "send">;
	return { client, objects, send };
}
function metadata(id: string): CandidateProvenance {
	return { title: "Article", siteName: "Example", excerpt: "", wordCount: 4, estimatedReadTime: 1,
		id: cid(id), attemptId: SaveAttemptIdSchema.parse(id), contentHash: id, originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: "2026-10-05T00:00:00Z" };
}

describe("immutable content candidates", () => {
	it("reads an earlier event's exact bytes after a later extraction replaces the tier pointer", async () => {
		const { client } = storage();
		const { putTierSource } = initPutTierSource({ client, bucketName: "content" });
		const { readTierSource } = initReadTierSource({ client, bucketName: "content", logger: noopLogger });
		await putTierSource({ url: URL, tier: "tier-1", html: "<p>First article</p>", evaluationHtml: "<html>First response</html>", metadata: metadata("first") });
		await putTierSource({ url: URL, tier: "tier-1", html: "<p>Second article</p>", metadata: metadata("second") });
		const old = await readTierSource({ url: URL, tier: "tier-1", candidateId: cid("first") });
		expect(old?.html).toBe("<p>First article</p>");
		expect(old?.evaluationHtml).toBe("<html>First response</html>");
		expect((await readTierSource({ url: URL, tier: "tier-1" }))?.html).toBe("<p>Second article</p>");
	});

	it("retires the legacy mutable tier body so an earlier author's capture does not outlive a recapture", async () => {
		const { client, objects } = storage();
		const legacyBodyKey = ArticleResourceUniqueId.parse(URL).toS3SourceKey({ tier: "tier-0" });
		objects.set(legacyBodyKey, "<p>Earlier author's capture</p>");
		await initPutTierSource({ client, bucketName: "content" }).putTierSource({ url: URL, tier: "tier-0", html: "<p>Co-saver capture</p>", metadata: { ...metadata("co-saver"), kind: "extension" } });
		expect(objects.get(legacyBodyKey)).toBe("");
		const { readTierSource } = initReadTierSource({ client, bucketName: "content", logger: noopLogger });
		expect((await readTierSource({ url: URL, tier: "tier-0" }))?.html).toBe("<p>Co-saver capture</p>");
	});

	it("keeps HTML paired with its own metadata when another save updates the tier pointer during the read", async () => {
		const { client, send } = storage();
		const { putTierSource } = initPutTierSource({ client, bucketName: "content" });
		await putTierSource({ url: URL, tier: "tier-1", html: "first body", metadata: metadata("first") });
		let changed = false;
		const racingClient = { send: async (command: unknown) => {
			const result = await send(command);
			if (!changed) { changed = true; await putTierSource({ url: URL, tier: "tier-1", html: "second body", metadata: metadata("second") }); }
			return result;
		} } as unknown as Pick<S3Client, "send">;
		const { readTierSource } = initReadTierSource({ client: racingClient, bucketName: "content", logger: noopLogger });
		const result = await readTierSource({ url: URL, tier: "tier-1" });
		expect({ html: result?.html, id: result?.metadata.id }).toEqual({ html: "first body", id: "first" });
	});

	it("references persisted selected bytes without mutating either storage layer", async () => {
		const { client, objects } = storage();
		const { putTierSource } = initPutTierSource({ client, bucketName: "content" });
		await putTierSource({ url: URL, tier: "tier-1", html: "selected exact bytes", metadata: metadata("selected") });
		const source = await initReadTierSource({ client, bucketName: "content", logger: noopLogger }).readTierSource({ url: URL, tier: "tier-1", candidateId: cid("selected") });
		assert(source, "persisted source must be readable");
		const verified = { ...source, metadata: CandidateProvenanceSchema.parse(source.metadata) };
		const before = [...objects];
		const { writeCanonicalContent } = initWriteCanonicalContent({ s3Client: client, bucketName: "content" });
		const commit = await writeCanonicalContent({ url: URL, source: verified });
		expect(commit.candidateId).toBe("selected");
		expect(objects.get(commit.contentLocation.slice("s3://content/".length))).toBe("selected exact bytes");
		expect([...objects]).toEqual(before);
	});

	it("reads ordinary legacy sources while leaving incomplete candidates unavailable", async () => {
		const { client, objects } = storage();
		const id = ArticleResourceUniqueId.parse(URL);
		const sidecar = id.toS3SourceMetadataKey({ tier: "tier-1" });
		const { readTierSource } = initReadTierSource({ client, bucketName: "content", logger: noopLogger });
		expect(await readTierSource({ url: URL, tier: "tier-1" })).toBeUndefined();
		objects.set(sidecar, JSON.stringify(metadata("legacy")));
		expect(await readTierSource({ url: URL, tier: "tier-1" })).toBeUndefined();
		objects.set(id.toS3SourceKey({ tier: "tier-1" }), "legacy body");
		expect((await readTierSource({ url: URL, tier: "tier-1" }))?.html).toBe("legacy body");
		objects.set(sidecar, JSON.stringify({ ...metadata("legacy"), evaluationLocation: "missing-evaluation.html" }));
		expect(await readTierSource({ url: URL, tier: "tier-1" })).toBeUndefined();
		objects.set(sidecar, JSON.stringify({ title: 4 }));
		expect(await readTierSource({ url: URL, tier: "tier-1" })).toBeUndefined();
	});

	it("propagates storage failures", async () => {
		const errors = [new Error("storage offline"), new S3ServiceException({ name: "NoSuchKey", $fault: "client", $metadata: {}, message: "missing" })];
		for (const error of errors) {
			const failing = { send: async () => { throw error; } } as unknown as Pick<S3Client, "send">;
			const read = initReadTierSource({ client: failing, bucketName: "content", logger: noopLogger }).readTierSource;
			if (error instanceof S3ServiceException) expect(await read({ url: URL, tier: "tier-1" })).toBeUndefined();
			else await expect(read({ url: URL, tier: "tier-1" })).rejects.toThrow("storage offline");
		}
		const empty = { send: async () => ({}) } as unknown as Pick<S3Client, "send">;
		expect(await initReadTierSource({ client: empty, bucketName: "content", logger: noopLogger }).readTierSource({ url: URL, tier: "tier-1" })).toBeUndefined();
		const denied = new S3ServiceException({ name: "AccessDenied", $fault: "client", $metadata: {}, message: "denied" });
		const forbidden = { send: async () => { throw denied; } } as unknown as Pick<S3Client, "send">;
		await expect(initReadTierSource({ client: forbidden, bucketName: "content", logger: noopLogger }).readTierSource({ url: URL, tier: "tier-1" })).rejects.toBe(denied);
	});
});

describe("candidate manifest identity", () => {
	it("keeps the first manifest unchanged on redelivery while preserving the exact body", async () => {
		const { client, objects } = storage();
		const { putTierSource } = initPutTierSource({ client, bucketName: "content" });
		await putTierSource({ url: URL, tier: "tier-1", html: "stable body", metadata: metadata("same") });
		await putTierSource({ url: URL, tier: "tier-1", html: "stable body", metadata: { ...metadata("same"), fetchedAt: "2026-10-06T00:00:00Z" } });
		const key = candidateManifestKey({ url: URL, tier: "tier-1", candidateId: cid("same") });
		expect(JSON.parse(objects.get(key) ?? "{}").fetchedAt).toBe("2026-10-05T00:00:00Z");
	});
	it("propagates manifest storage failures instead of overwriting the current source", async () => {
		for (const failure of [new Error("offline"), new S3ServiceException({ name: "AccessDenied", $fault: "client", $metadata: {}, message: "denied" })]) {
			const { send } = storage();
			const failing = { send: async (command: unknown) => {
				const input = CommandSchema.parse(command).input;
				if (input.Key.endsWith("metadata.json")) throw failure;
				return send(command);
			} } as unknown as Pick<S3Client, "send">;
			const put = initPutTierSource({ client: failing, bucketName: "content" }).putTierSource;
			await expect(put({ url: URL, tier: "tier-1", html: "body", metadata: metadata("failure") })).rejects.toBe(failure);
		}
	});
});

describe("immutable candidate upload", () => {
	it("uses separate immutable candidate IDs when a retry localizes media differently", async () => {
		const { client, objects } = storage();
		const persist = initPersistCandidateArtifact({ client, bucketName: "content" });
		const first = await persist(params);
		const html = HTML.replace("https://example.com/photo.jpg", "https://cdn.example/photo.jpg");
		const metadata = candidateProvenance({ metadata: params.metadata, html, evaluationHtml: HTML, attemptId: SaveAttemptIdSchema.parse("attempt"), originalUrl: URL, sourceUrl: URL, kind: "extension", fetchedAt: params.metadata.fetchedAt });
		const second = await persist({ ...params, html, metadata });
		expect(first.id).toBe(params.metadata.id);
		expect(second.id).toBe(metadata.id);
		expect(objects.get(first.htmlLocation ?? "")).toBe(HTML);
		expect(objects.get(second.htmlLocation ?? "")).toBe(html);
		expect(second.contentHash).toBe(first.contentHash);
	});
	it("keeps the ownership manifest when a body upload fails", async () => {
		const { client, objects } = storage((input) => { if (input.Key.endsWith("content.html")) throw new Error("body upload interrupted"); });
		await expect(initPersistCandidateArtifact({ client, bucketName: "content" })(params)).rejects.toThrow("body upload interrupted");
		expect([...objects.keys()]).toEqual([candidateManifestKey({ ...params, candidateId: params.metadata.id })]);
	});
});

describe("canonical promotion", () => {
	it("materializes a verified legacy direct canonical once and rejects unpersisted ordinary candidates", async () => {
		const { client, objects } = storage();
		const { writeCanonicalContent } = initWriteCanonicalContent({ s3Client: client, bucketName: "content" });
		await expect(writeCanonicalContent({ url: URL, source: params })).rejects.toThrow("must already be persisted");
		const commit = await writeCanonicalContent({ url: URL, source: { ...params, metadata: { ...params.metadata, attemptId: "legacy-direct-canonical" } } });
		expect(commit.contentLocation).toBe(`s3://content/${candidateBodyKeys({ url: URL, tier: params.tier, candidateId: params.metadata.id }).htmlLocation}`);
		expect(objects.get(candidateBodyKeys({ url: URL, tier: params.tier, candidateId: params.metadata.id }).htmlLocation)).toBe(HTML);
	});
});
