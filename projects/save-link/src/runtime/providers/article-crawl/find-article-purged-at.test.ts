import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { initFindArticlePurgedAt } from "./find-article-purged-at";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(
	impl: (input: unknown) => unknown,
): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (input: unknown) => impl(input)) as unknown as SendFn,
	};
}

const TABLE = "test-articles";

function findWith(answer: unknown) {
	const client = createFakeClient(() => answer);
	return initFindArticlePurgedAt({
		client: client as DynamoDBDocumentClient,
		tableName: TABLE,
	}).findArticlePurgedAt;
}

describe("initFindArticlePurgedAt", () => {
	it("returns purgedAt from a tombstone", async () => {
		const findArticlePurgedAt = findWith({ Item: { purgedAt: "2026-07-16T10:00:00.000Z" } });

		await expect(findArticlePurgedAt("https://example.com/a")).resolves.toBe("2026-07-16T10:00:00.000Z");
	});

	it("returns undefined for a live row with no projected attributes", async () => {
		const findArticlePurgedAt = findWith({ Item: {} });

		await expect(findArticlePurgedAt("https://example.com/a")).resolves.toBeUndefined();
	});

	it("returns undefined when no row exists", async () => {
		const findArticlePurgedAt = findWith({});

		await expect(findArticlePurgedAt("https://example.com/a")).resolves.toBeUndefined();
	});

	it("reads the tombstone's key and projects only purgedAt", async () => {
		let received: unknown;
		const client = createFakeClient((input) => {
			received = input;
			return {};
		});
		const { findArticlePurgedAt } = initFindArticlePurgedAt({
			client: client as DynamoDBDocumentClient,
			tableName: TABLE,
		});

		await findArticlePurgedAt("https://example.com/a?b=1");

		const command = received as {
			input: {
				TableName?: string;
				Key?: Record<string, unknown>;
				ProjectionExpression?: string;
				ExpressionAttributeNames?: Record<string, string>;
			};
		};
		expect(command.input.TableName).toBe(TABLE);
		expect(command.input.Key).toEqual({ url: "example.com/a?b=1" });
		expect(command.input.ProjectionExpression).toContain("#purgedAt");
		expect(command.input.ExpressionAttributeNames).toEqual({ "#purgedAt": "purgedAt" });
	});
});
