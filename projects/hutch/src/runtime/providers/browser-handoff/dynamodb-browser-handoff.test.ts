import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { BrowserHandoffCodeSchema } from "@packages/provider-contracts/browser-handoff";
import { initDynamoDbBrowserHandoff } from "./dynamodb-browser-handoff";

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

/** Records commands and replays the row a DeleteCommand with ReturnValues:ALL_OLD
 * would return, or throws a supplied error so the rejection paths can be asserted. */
function createFakeClient(opts: {
	deleteAttributes?: Record<string, unknown>;
	deleteError?: Error;
}): { client: DynamoDBDocumentClient; commands: CapturedCommand[] } {
	const commands: CapturedCommand[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (name === "DeleteCommand") {
				if (opts.deleteError) throw opts.deleteError;
				return opts.deleteAttributes ? { Attributes: opts.deleteAttributes } : {};
			}
			return {};
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

const TABLE = "browser-handoff-codes";
const NOW_SECONDS = 1_700_000_000;
const CODE = BrowserHandoffCodeSchema.parse("a".repeat(43));
const IDENTITY = {
	userId: UserIdSchema.parse("user-1"),
	emailVerified: true,
	oauthClientId: "readplace-ios",
};

function initStore(client: DynamoDBDocumentClient) {
	return initDynamoDbBrowserHandoff({ client, tableName: TABLE, now: () => new Date(NOW_SECONDS * 1000) });
}

describe("initDynamoDbBrowserHandoff", () => {
	describe("mintBrowserHandoffCode", () => {
		it("puts a 43-character base64url code with the minting identity and a 60-second TTL", async () => {
			const { client, commands } = createFakeClient({});

			const code = await initStore(client).mintBrowserHandoffCode(IDENTITY);

			expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
			const put = commands.find((c) => c.name === "PutCommand");
			expect(put?.input.TableName).toBe(TABLE);
			expect(put?.input.Item).toEqual({ code, ...IDENTITY, expiresAt: NOW_SECONDS + 60 });
		});
	});

	describe("redeemBrowserHandoffCode", () => {
		it("consumes the code once and returns the minting identity", async () => {
			const { client, commands } = createFakeClient({
				deleteAttributes: { code: CODE, ...IDENTITY, expiresAt: NOW_SECONDS + 60 },
			});

			const result = await initStore(client).redeemBrowserHandoffCode(CODE);

			expect(result).toEqual({ ok: true, ...IDENTITY });
			const del = commands.find((c) => c.name === "DeleteCommand");
			expect(del?.input.Key).toEqual({ code: CODE });
			expect(del?.input.ConditionExpression).toBe("attribute_exists(#code)");
			expect(del?.input.ExpressionAttributeNames).toEqual({ "#code": "code" });
			expect(del?.input.ReturnValues).toBe("ALL_OLD");
		});

		it("rejects an expired code whose row DynamoDB's TTL has not reaped yet", async () => {
			const { client } = createFakeClient({
				deleteAttributes: { code: CODE, ...IDENTITY, expiresAt: NOW_SECONDS - 1 },
			});

			expect(await initStore(client).redeemBrowserHandoffCode(CODE)).toEqual({
				ok: false,
				reason: "invalid-code",
			});
		});

		it("rejects a consumed or unknown code when the attribute_exists condition fails", async () => {
			const { client } = createFakeClient({
				deleteError: new ConditionalCheckFailedException({ $metadata: {}, message: "missing" }),
			});

			expect(await initStore(client).redeemBrowserHandoffCode(CODE)).toEqual({
				ok: false,
				reason: "invalid-code",
			});
		});

		it("rethrows non-conditional delete errors", async () => {
			const { client } = createFakeClient({ deleteError: new Error("throttled") });

			await expect(initStore(client).redeemBrowserHandoffCode(CODE)).rejects.toThrow("throttled");
		});
	});
});
