import { CandidateIdSchema, SaveAttemptIdSchema } from "@packages/domain/article";
import { NoSuchKey, S3ServiceException, type S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { initPutTierSource } from "./put-tier-source";
import { initPersistCandidateArtifact } from "./persist-candidate-artifact";
import { candidateBodyKeys, candidateManifestKey } from "./candidate-object-keys";
import { CandidateProvenanceSchema, type CandidateProvenance } from "./tier-source.types";
import { candidateProvenance } from "./candidate-provenance";
import { KNOWN_TIERS } from "@packages/article-state-types";

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

describe("candidate manifest identity", () => {
	it("keeps the first manifest unchanged on redelivery while preserving the exact body", async () => {
		const { client, objects } = storage();
		const { putTierSource } = initPutTierSource({ client, bucketName: "content" });
		await putTierSource({ url: URL, tier: "tier-1", html: "stable body", metadata: metadata("same") });
		await putTierSource({ url: URL, tier: "tier-1", html: "stable body", metadata: { ...metadata("same"), fetchedAt: "2026-10-06T00:00:00Z" } });
		const key = candidateManifestKey({ url: URL, tier: "tier-1", candidateId: cid("same") });
		expect(JSON.parse(objects.get(key) ?? "{}").fetchedAt).toBe("2026-10-05T00:00:00Z");
	});
	it("keeps every candidate key within S3's 1024-byte limit at the longest unhashed article segment", () => {
		const url = `https://example.com/${"a".repeat(886)}`;
		expect(ArticleResourceUniqueId.parse(url).toS3SourcesPrefix().length).toBe("articles/".length + 900 + "/sources/".length);
		const keys = KNOWN_TIERS.flatMap((tier) => {
			const candidate = { url, tier, candidateId: cid("candidate") };
			const { htmlLocation, evaluationLocation } = candidateBodyKeys(candidate);
			return [candidateManifestKey(candidate), htmlLocation, evaluationLocation];
		});
		expect(keys.filter((key) => Buffer.byteLength(key) > 1024)).toEqual([]);
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

describe("tier pointer", () => {
	it("writes the sidecar metadata and an empty legacy body at the tier keys", async () => {
		const { client, objects } = storage();
		const { putTierSource } = initPutTierSource({ client, bucketName: "content" });
		await putTierSource(params);
		const id = ArticleResourceUniqueId.parse(URL);
		const sidecar = CandidateProvenanceSchema.parse(JSON.parse(objects.get(id.toS3SourceMetadataKey({ tier: "tier-0" })) ?? "{}"));
		expect(sidecar.htmlLocation).toBe(candidateBodyKeys({ url: URL, tier: "tier-0", candidateId: params.metadata.id }).htmlLocation);
		expect(objects.get(id.toS3SourceKey({ tier: "tier-0" }))).toBe("");
	});
});
