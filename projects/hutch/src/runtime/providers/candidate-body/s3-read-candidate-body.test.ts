import assert from "node:assert/strict";
import { type GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import type { S3GetObject } from "@packages/article-store";
import { CandidateIdSchema } from "@packages/domain/article";
import { candidateBodyKeys } from "@packages/tier-source";
import { initS3ReadCandidateBody } from "./s3-read-candidate-body";

const BUCKET = "hutch-content-test";
const URL_A = "https://example.com/harbour";
const CANDIDATE = CandidateIdSchema.parse("candidate-one");
const keyOf = (tier: "tier-0" | "tier-1" | "tier-2") => candidateBodyKeys({ url: URL_A, tier, candidateId: CANDIDATE }).htmlLocation;

function bucketHolding(objects: Record<string, string>) {
	const calls: GetObjectCommand[] = [];
	const send: S3GetObject = async (command) => {
		calls.push(command);
		const body = command.input.Key === undefined ? undefined : objects[command.input.Key];
		if (body === undefined) throw new NoSuchKey({ message: "The specified key does not exist.", $metadata: {} });
		return { Body: { transformToString: async () => body } };
	};
	return { send, calls };
}

describe("initS3ReadCandidateBody", () => {
	it("reads the body of the first tier that holds the candidate", async () => {
		const bucket = bucketHolding({ [keyOf("tier-1")]: "<p>tier one</p>", [keyOf("tier-2")]: "<p>tier two</p>" });
		const read = initS3ReadCandidateBody({ send: bucket.send, bucketName: BUCKET });

		assert.equal(await read({ url: URL_A, candidateId: CANDIDATE }), "<p>tier one</p>");
		assert.deepEqual(
			bucket.calls.map((call) => [call.input.Bucket, call.input.Key]),
			[
				[BUCKET, keyOf("tier-0")],
				[BUCKET, keyOf("tier-1")],
			],
		);
	});

	it("returns undefined when no tier holds the candidate", async () => {
		const bucket = bucketHolding({});
		const read = initS3ReadCandidateBody({ send: bucket.send, bucketName: BUCKET });

		assert.equal(await read({ url: URL_A, candidateId: CANDIDATE }), undefined);
		assert.equal(bucket.calls.length, 3);
	});

	it("rethrows any other S3 error", async () => {
		const send: S3GetObject = async () => {
			throw new Error("ThrottlingException");
		};
		const read = initS3ReadCandidateBody({ send, bucketName: BUCKET });

		await assert.rejects(read({ url: URL_A, candidateId: CANDIDATE }), /ThrottlingException/);
	});
});
