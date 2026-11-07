import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { z } from "zod";
import { initReadCanonicalSnapshot } from "./read-canonical-snapshot";

function readerOver(row: Record<string, unknown> | undefined) {
	const sent: unknown[] = [];
	const client = {
		send: async (command: unknown) => {
			sent.push(command);
			return { Item: row };
		},
	} as unknown as Pick<DynamoDBDocumentClient, "send">;
	return { read: initReadCanonicalSnapshot({ client, tableName: "articles" }), sent };
}

const CommandInput = z.object({
	input: z.looseObject({}),
});

describe("initReadCanonicalSnapshot", () => {
	it("returns the canonical hash and candidate id together", async () => {
		const { read } = readerOver({ canonicalContentHash: "hash-1", canonicalCandidateId: "candidate-1" });

		expect(await read("https://example.com/post")).toEqual({
			canonicalContentHash: "hash-1",
			canonicalCandidateId: "candidate-1",
		});
	});

	it("returns the hash alone for a row with no candidate id", async () => {
		const { read } = readerOver({ canonicalContentHash: "hash-1" });

		expect(await read("https://example.com/post")).toEqual({ canonicalContentHash: "hash-1" });
	});

	it.each([undefined, { canonicalCandidateId: "candidate-1" }])(
		"returns undefined for no row or no canonical hash %j",
		async (row) => {
			const { read } = readerOver(row);

			expect(await read("https://example.com/post")).toBeUndefined();
		},
	);

	it("reads the parsed url with a consistent read", async () => {
		const { read, sent } = readerOver(undefined);

		await read("https://EXAMPLE.com/post");

		const { input } = CommandInput.parse(sent[0]);
		expect(input).toEqual({
			TableName: "articles",
			Key: { url: ArticleResourceUniqueId.parse("https://example.com/post").value },
			ConsistentRead: true,
			ProjectionExpression: "#canonicalContentHash, #canonicalCandidateId",
			ExpressionAttributeNames: {
				"#canonicalContentHash": "canonicalContentHash",
				"#canonicalCandidateId": "canonicalCandidateId",
			},
		});
	});
});
