import type { S3Client } from "@aws-sdk/client-s3";
import { initS3ListContentKeys } from "./s3-list-content-keys";

/**
 * 1. The S3 client `send` is a heavily-overloaded generic the test fake cannot
 *    structurally satisfy; the single contained cast is the isolated
 *    SDK-wrapper exception in CLAUDE.md "Avoid TypeScript Type Assertions".
 */
function createFakeS3(
	pages: { Contents?: { Key?: string }[]; NextContinuationToken?: string }[],
	capture: (input: Record<string, unknown>) => void,
): Pick<S3Client, "send"> {
	let call = 0;
	const send = async (command: { input: Record<string, unknown> }) => {
		capture(command.input);
		const page = pages[call];
		call += 1;
		return page;
	};
	return { send } as unknown as Pick<S3Client, "send"> /* 1 */;
}

const BUCKET = "content-bucket";

describe("initS3ListContentKeys", () => {
	it("lists every key under the prefix across continuation pages", async () => {
		const inputs: Record<string, unknown>[] = [];
		const { listContentKeys } = initS3ListContentKeys({
			client: createFakeS3(
				[
					{ Contents: [{ Key: "p/a" }, { Key: "p/b" }], NextContinuationToken: "token-1" },
					{ Contents: [{ Key: "p/c" }] },
				],
				(input) => inputs.push(input),
			),
			bucketName: BUCKET,
		});

		const keys = await listContentKeys("p/");

		expect(keys).toEqual(["p/a", "p/b", "p/c"]);
		expect(inputs).toEqual([
			{ Bucket: BUCKET, Prefix: "p/" },
			{ Bucket: BUCKET, Prefix: "p/", ContinuationToken: "token-1" },
		]);
	});

	it("returns an empty list for a prefix with no objects", async () => {
		const { listContentKeys } = initS3ListContentKeys({
			client: createFakeS3([{}], () => {}),
			bucketName: BUCKET,
		});

		expect(await listContentKeys("empty/")).toEqual([]);
	});

	it("skips entries the SDK reports without a Key", async () => {
		const { listContentKeys } = initS3ListContentKeys({
			client: createFakeS3([{ Contents: [{ Key: "p/a" }, {}] }], () => {}),
			bucketName: BUCKET,
		});

		expect(await listContentKeys("p/")).toEqual(["p/a"]);
	});
});
