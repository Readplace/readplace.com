import assert from "node:assert/strict";
import type { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { mediaFilename, type MediaWriteContext } from "@packages/finalize-article";
import { initS3PutImageObject } from "./s3-put-image-object";

const context = { url: "https://example.com/article", attemptId: SaveAttemptIdSchema.parse("attempt"), authorUserId: UserIdSchema.parse("alice") };
const image = { sourceUrl: "https://example.com/image.png", body: Buffer.from("private-image"), extension: ".png" };
function upload(writeContext: MediaWriteContext = context) {
	return { key: ArticleResourceUniqueId.parse(writeContext.url).toS3ImageKey(mediaFilename({ ...image, writeContext })), body: image.body, contentType: "image/png", writeContext };
}
function ownerKey(writeContext: MediaWriteContext = context) {
	return `articles/example.com%2Farticle/sources/media-owners/${mediaFilename({ ...image, writeContext }).slice("attempts/".length)}.metadata.json`;
}
function storage(options: { before?: (command: PutObjectCommand) => void } = {}) {
	const objects = new Map<string, string | Buffer>();
	const commands: PutObjectCommand[] = [];
	const client = { send: async (command: PutObjectCommand) => {
		commands.push(command);
		options.before?.(command);
		const key = command.input.Key;
		assert(key);
		const body = command.input.Body;
		assert(typeof body === "string" || Buffer.isBuffer(body));
		objects.set(key, body);
		return {};
	} } as unknown as Pick<S3Client, "send">;
	return { client, objects, commands };
}
function writer(client: Pick<S3Client, "send">) {
	return initS3PutImageObject({ client, bucketName: "content" }).putImageObject;
}

it("requires an observed write context before any storage access", async () => {
	const store = storage();
	await expect(writer(store.client)({ ...upload(), writeContext: undefined })).rejects.toThrow("write context");
	expect(store.commands).toEqual([]);
});

it("writes ownership outside the served media prefix before image bytes and accepts identical retries", async () => {
	const store = storage();
	const putImageObject = writer(store.client);
	await putImageObject(upload());
	await putImageObject(upload());
	expect([...store.objects.keys()]).toEqual([ownerKey(), upload().key]);
	expect(upload().key).toMatch(/^content\/example\.com%2Farticle\/images\/attempts\/[a-f0-9]{64}\/[a-f0-9]{64}\.png$/);
	expect(store.objects.get(upload().key)).toEqual(image.body);
	const manifest = JSON.parse(String(store.objects.get(ownerKey())));
	expect(manifest).toEqual({ authorUserId: "alice", objectKey: upload().key });
});

it("keeps anonymous media in a separate scope with no ownership manifest", async () => {
	const store = storage();
	const { authorUserId: _author, ...anonymous } = context;
	await writer(store.client)(upload(anonymous));
	expect([...store.objects.keys()]).toEqual([upload(anonymous).key]);
	expect(store.objects.get(upload(anonymous).key)).toEqual(image.body);
});

it("rethrows manifest upload faults", async () => {
	const error = new Error("offline");
	const store = storage({ before: () => { throw error; } });
	await expect(writer(store.client)(upload())).rejects.toBe(error);
});

it("retains ownership when image upload fails", async () => {
	const error = new Error("offline");
	const store = storage({ before: (command) => { if (command.input.Key === upload().key) throw error; } });
	await expect(writer(store.client)(upload())).rejects.toBe(error);
	expect([...store.objects.keys()]).toEqual([ownerKey()]);
});
