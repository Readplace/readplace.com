import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { NoSuchKey, type S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { initS3StagedObject } from "./s3-staged-object";

const KEY = "pending/0123456789abcdef0123456789abcdef/original";

function setUp(answer: (name: string) => Promise<unknown>) {
	const sent: { name: string; input: unknown }[] = [];
	const send = async (command: { constructor: { name: string }; input: unknown }) => {
		sent.push({ name: command.constructor.name, input: command.input });
		return answer(command.constructor.name);
	};
	const client: Pick<S3Client, "send"> = { send: send as unknown as S3Client["send"] };
	return { sent, ...initS3StagedObject({ client, bucketName: "hutch-media-test" }) };
}

describe("initS3StagedObject", () => {
	it("reads the pending original only while its etag matches, with its content length", async () => {
		const body = Readable.from([Buffer.from("ID3")]);
		const { sent, readStagedObject } = setUp(async () => ({ Body: body, ContentLength: 3 }));

		assert.deepEqual(await readStagedObject({ key: KEY, etag: '"abc"' }), { body, contentLength: 3 });
		assert.deepEqual(sent, [{ name: "GetObjectCommand", input: { Bucket: "hutch-media-test", Key: KEY, IfMatch: '"abc"' } }]);
	});

	it.each([
		{ cause: "the key is gone", error: new NoSuchKey({ message: "missing", $metadata: { httpStatusCode: 404 } }) },
		{ cause: "the etag no longer matches", error: new S3ServiceException({ name: "PreconditionFailed", $fault: "client", message: "etag", $metadata: { httpStatusCode: 412 } }) },
	])("answers staged-bytes-gone when $cause", async ({ error }) => {
		const { readStagedObject } = setUp(async () => {
			throw error;
		});

		assert.equal(await readStagedObject({ key: KEY, etag: '"abc"' }), "staged-bytes-gone");
	});

	it("rejects on any other S3 failure", async () => {
		const { readStagedObject } = setUp(async () => {
			throw new S3ServiceException({ name: "AccessDenied", $fault: "client", message: "denied", $metadata: { httpStatusCode: 403 } });
		});

		await assert.rejects(readStagedObject({ key: KEY, etag: '"abc"' }), /denied/);
	});

	it("copies the pending original to the object key under the probed media type, only while its etag matches", async () => {
		const { sent, copyStagedTo } = setUp(async () => ({}));

		await copyStagedTo({ stagedKey: KEY, etag: '"abc"', targetKey: `objects/sha256/${"a".repeat(64)}/1`, contentType: "audio/mpeg" });

		assert.deepEqual(sent, [
			{ name: "CopyObjectCommand", input: { Bucket: "hutch-media-test", Key: `objects/sha256/${"a".repeat(64)}/1`, CopySource: `hutch-media-test/${KEY}`, CopySourceIfMatch: '"abc"', ContentType: "audio/mpeg", MetadataDirective: "REPLACE" } },
		]);
	});
});
