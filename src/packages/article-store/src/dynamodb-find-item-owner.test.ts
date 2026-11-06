import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbFindItemOwner } from "./dynamodb-find-item-owner";

type SendFn = DynamoDBDocumentClient["send"];

function createSendingClient(impl: (input: unknown) => unknown): DynamoDBDocumentClient {
	return {
		send: (async (command: { input: unknown }) => impl(command.input)) as unknown as SendFn,
	} as Partial<DynamoDBDocumentClient> as DynamoDBDocumentClient;
}

const PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";

describe("initDynamoDbFindItemOwner", () => {
	it("reads the owner of the item's row by its key", async () => {
		const requests: unknown[] = [];
		const { findItemOwner } = initDynamoDbFindItemOwner({
			client: createSendingClient((input) => {
				requests.push(input);
				return { Item: { ownerUserId: "owner-user" } };
			}),
			tableName: "articles",
		});

		expect(await findItemOwner(PRIVATE_URL)).toEqual(UserIdSchema.parse("owner-user"));
		expect(requests).toEqual([
			expect.objectContaining({
				TableName: "articles",
				Key: { url: "uploads.readplace.invalid/0123456789abcdef0123456789abcdef" },
				ConsistentRead: true,
			}),
		]);
	});

	it("answers no owner when the row has none", async () => {
		const { findItemOwner } = initDynamoDbFindItemOwner({
			client: createSendingClient(() => ({ Item: {} })),
			tableName: "articles",
		});

		expect(await findItemOwner(PRIVATE_URL)).toBeUndefined();
	});

	it("answers no owner when the row is gone", async () => {
		const { findItemOwner } = initDynamoDbFindItemOwner({
			client: createSendingClient(() => ({ Item: undefined })),
			tableName: "articles",
		});

		expect(await findItemOwner(PRIVATE_URL)).toBeUndefined();
	});
});
