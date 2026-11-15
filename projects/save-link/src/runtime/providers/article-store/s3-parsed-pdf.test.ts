import assert from "node:assert/strict";
import { NoSuchKey, S3ServiceException, type S3Client } from "@aws-sdk/client-s3";
import { UserIdSchema } from "@packages/article-state-types";
import { z } from "zod";
import { initS3ParsedPdf } from "./s3-parsed-pdf";

const userId = UserIdSchema.parse("user-1");
const fileHash = "ab".repeat(32);
const CommandSchema = z.object({ input: z.object({ Bucket: z.string(), Key: z.string(), Body: z.string().optional(), ContentType: z.string().optional() }) });

function bucket() {
	const objects = new Map<string, string>();
	const writes: Array<z.infer<typeof CommandSchema>["input"]> = [];
	const send = async (command: unknown) => {
		const input = CommandSchema.parse(command).input;
		if (input.Body !== undefined) {
			writes.push(input);
			objects.set(input.Key, input.Body);
			return {};
		}
		const body = objects.get(input.Key);
		if (body === undefined) throw new NoSuchKey({ $metadata: {}, message: "missing" });
		return { Body: { transformToString: async () => body } };
	};
	const client = { send } as unknown as Pick<S3Client, "send">;
	return { client, objects, writes };
}

describe("initS3ParsedPdf", () => {
	it("keeps a parse under the reader's account prefix and finds it again", async () => {
		const { client, writes } = bucket();
		const { findParsedPdf, keepParsedPdf } = initS3ParsedPdf({ client, bucketName: "content" });

		await keepParsedPdf({ userId, fileHash, html: "<p>body</p>", title: "Report" });
		const found = await findParsedPdf({ userId, fileHash });

		assert.equal(writes.length, 1);
		assert.equal(writes[0].Bucket, "content");
		assert.equal(writes[0].Key, `pdf-extract/account/user-1/${fileHash}.json`);
		assert.equal(writes[0].ContentType, "application/json; charset=utf-8");
		assert.deepEqual(found, { html: "<p>body</p>", title: "Report" });
	});

	it("misses when nothing is stored for the file", async () => {
		const { client } = bucket();
		const { findParsedPdf } = initS3ParsedPdf({ client, bucketName: "content" });

		assert.equal(await findParsedPdf({ userId, fileHash }), undefined);
	});

	it("misses when the stored body does not match the parse shape", async () => {
		const { client, objects } = bucket();
		objects.set(`pdf-extract/account/user-1/${fileHash}.json`, JSON.stringify({ html: "<p>body</p>" }));
		const { findParsedPdf } = initS3ParsedPdf({ client, bucketName: "content" });

		assert.equal(await findParsedPdf({ userId, fileHash }), undefined);
	});

	it("misses when the stored body is not JSON", async () => {
		const { client, objects } = bucket();
		objects.set(`pdf-extract/account/user-1/${fileHash}.json`, "not json");
		const { findParsedPdf } = initS3ParsedPdf({ client, bucketName: "content" });

		assert.equal(await findParsedPdf({ userId, fileHash }), undefined);
	});

	it("misses when the object has no body", async () => {
		const client = { send: async () => ({}) } as unknown as Pick<S3Client, "send">;
		const { findParsedPdf } = initS3ParsedPdf({ client, bucketName: "content" });

		assert.equal(await findParsedPdf({ userId, fileHash }), undefined);
	});

	it("throws any other storage error", async () => {
		const denied = new S3ServiceException({ name: "AccessDenied", $fault: "client", $metadata: { httpStatusCode: 403 }, message: "denied" });
		const client = { send: async () => { throw denied; } } as unknown as Pick<S3Client, "send">;
		const { findParsedPdf } = initS3ParsedPdf({ client, bucketName: "content" });

		await assert.rejects(findParsedPdf({ userId, fileHash }), denied);
	});
});
