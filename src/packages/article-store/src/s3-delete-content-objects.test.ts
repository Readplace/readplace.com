import type { S3Client } from "@aws-sdk/client-s3";
import { initS3DeleteContentObjects } from "./s3-delete-content-objects";

/**
 * 1. The S3 client `send` is a heavily-overloaded generic the test fake cannot
 *    structurally satisfy; the single contained cast is the isolated
 *    SDK-wrapper exception in CLAUDE.md "Avoid TypeScript Type Assertions".
 */
function createFakeS3(capture: (input: Record<string, unknown>) => void): Pick<S3Client, "send"> {
	const send = async (command: { input: Record<string, unknown> }) => {
		capture(command.input);
		return {};
	};
	return { send } as unknown as Pick<S3Client, "send"> /* 1 */;
}

const BUCKET = "content-bucket";

describe("initS3DeleteContentObjects", () => {
	it("issues one DeleteObjects request with the exact keys", async () => {
		const inputs: Record<string, unknown>[] = [];
		const { deleteContentObjects } = initS3DeleteContentObjects({
			client: createFakeS3((input) => inputs.push(input)),
			bucketName: BUCKET,
		});

		await deleteContentObjects(["a.html", "b/metadata.json"]);

		expect(inputs).toEqual([
			{
				Bucket: BUCKET,
				Delete: { Objects: [{ Key: "a.html" }, { Key: "b/metadata.json" }] },
			},
		]);
	});

	it("issues no request for an empty key list", async () => {
		const inputs: Record<string, unknown>[] = [];
		const { deleteContentObjects } = initS3DeleteContentObjects({
			client: createFakeS3((input) => inputs.push(input)),
			bucketName: BUCKET,
		});

		await deleteContentObjects([]);

		expect(inputs).toEqual([]);
	});

	it("splits more than 1000 keys across requests at the DeleteObjects cap", async () => {
		const inputs: Record<string, unknown>[] = [];
		const { deleteContentObjects } = initS3DeleteContentObjects({
			client: createFakeS3((input) => inputs.push(input)),
			bucketName: BUCKET,
		});
		const keys = Array.from({ length: 1001 }, (_v, i) => `key-${i}`);

		await deleteContentObjects(keys);

		expect(inputs).toHaveLength(2);
		const first = inputs[0].Delete as { Objects: { Key: string }[] };
		const second = inputs[1].Delete as { Objects: { Key: string }[] };
		expect(first.Objects).toHaveLength(1000);
		expect(second.Objects).toEqual([{ Key: "key-1000" }]);
	});
});
