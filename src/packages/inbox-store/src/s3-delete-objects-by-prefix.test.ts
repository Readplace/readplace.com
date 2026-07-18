import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { initS3DeleteObjectsByPrefix } from "./s3-delete-objects-by-prefix";

type SendFn = S3Client["send"];

interface ListPage {
	Contents?: { Key?: string }[];
	NextContinuationToken?: string;
}

interface CapturedList {
	prefix: string | undefined;
	continuationToken: string | undefined;
}

interface CapturedDelete {
	bucket: string | undefined;
	keys: (string | undefined)[];
}

function fakeClient(pagesByPrefix: Record<string, ListPage[]>): {
	client: Pick<S3Client, "send">;
	lists: CapturedList[];
	deletes: CapturedDelete[];
} {
	const lists: CapturedList[] = [];
	const deletes: CapturedDelete[] = [];
	const served: Record<string, number> = {};
	return {
		client: {
			send: (async (cmd: unknown) => {
				if (cmd instanceof ListObjectsV2Command) {
					const prefix = cmd.input.Prefix;
					lists.push({ prefix, continuationToken: cmd.input.ContinuationToken });
					const pages = pagesByPrefix[prefix ?? ""] ?? [{}];
					const index = served[prefix ?? ""] ?? 0;
					served[prefix ?? ""] = index + 1;
					return pages[index];
				}
				const input = (cmd as { input: { Bucket?: string; Delete?: { Objects?: { Key?: string }[] } } })
					.input;
				deletes.push({
					bucket: input.Bucket,
					keys: (input.Delete?.Objects ?? []).map((object) => object.Key),
				});
				return {};
			}) as unknown as SendFn,
		},
		lists,
		deletes,
	};
}

describe("initS3DeleteObjectsByPrefix", () => {
	it("lists each prefix with a slash boundary and deletes what it finds", async () => {
		const { client, lists, deletes } = fakeClient({
			"content/email-images/aaa/": [
				{ Contents: [{ Key: "content/email-images/aaa/x.png" }, { Key: "content/email-images/aaa/y.jpg" }] },
			],
		});
		const del = initS3DeleteObjectsByPrefix({ client, bucketName: "content-bucket" });

		await del(["content/email-images/aaa"]);

		expect(lists).toEqual([
			{ prefix: "content/email-images/aaa/", continuationToken: undefined },
		]);
		expect(deletes).toEqual([
			{
				bucket: "content-bucket",
				keys: ["content/email-images/aaa/x.png", "content/email-images/aaa/y.jpg"],
			},
		]);
	});

	it("issues no delete for an empty prefix", async () => {
		const { client, deletes } = fakeClient({
			"content/email-images/bbb/": [{ Contents: [] }],
			"content/email-images/ccc/": [{}],
		});
		const del = initS3DeleteObjectsByPrefix({ client, bucketName: "content-bucket" });

		await del(["content/email-images/bbb", "content/email-images/ccc"]);

		expect(deletes).toHaveLength(0);
	});

	it("follows continuation tokens across list pages and skips keyless entries", async () => {
		const { client, lists, deletes } = fakeClient({
			"content/email-images/ddd/": [
				{
					Contents: [{ Key: "content/email-images/ddd/1.png" }, {}],
					NextContinuationToken: "page-2",
				},
				{ Contents: [{ Key: "content/email-images/ddd/2.png" }] },
			],
		});
		const del = initS3DeleteObjectsByPrefix({ client, bucketName: "content-bucket" });

		await del(["content/email-images/ddd"]);

		expect(lists.map((list) => list.continuationToken)).toEqual([undefined, "page-2"]);
		expect(deletes.map((request) => request.keys)).toEqual([
			["content/email-images/ddd/1.png"],
			["content/email-images/ddd/2.png"],
		]);
	});
});
