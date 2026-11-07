import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbIsAccountLive } from "./dynamodb-is-account-live";

const USERS_TABLE = "users";
const userId = UserIdSchema.parse("user-1");

type SentInput = Record<string, unknown>;

function fakeUsersTable(rows: {
	indexed?: { email: string };
	byEmail?: Record<string, unknown>;
}) {
	const sent: SentInput[] = [];
	const client = {
		send: async (command: { input: SentInput }) => {
			sent.push(command.input);
			if (command.input.IndexName === "userId-index") {
				return { Items: rows.indexed === undefined ? [] : [rows.indexed], Count: rows.indexed === undefined ? 0 : 1 };
			}
			return { Item: rows.byEmail };
		},
	};
	const isAccountLive = initDynamoDbIsAccountLive({
		client,
		usersTableName: USERS_TABLE,
	});
	return { isAccountLive, sent };
}

describe("initDynamoDbIsAccountLive", () => {
	it("answers live for a users row that still names this user and has no deletedAt", async () => {
		const { isAccountLive } = fakeUsersTable({
			indexed: { email: "reader@example.com" },
			byEmail: { userId: "user-1" },
		});

		expect(await isAccountLive(userId)).toBe(true);
	});

	it("answers not live once the row carries deletedAt", async () => {
		const { isAccountLive } = fakeUsersTable({
			indexed: { email: "reader@example.com" },
			byEmail: { userId: "user-1", deletedAt: "2026-11-01T00:00:00.000Z" },
		});

		expect(await isAccountLive(userId)).toBe(false);
	});

	it("answers not live when the userId-index holds no row for the user", async () => {
		const { isAccountLive, sent } = fakeUsersTable({});

		expect(await isAccountLive(userId)).toBe(false);
		expect(sent).toHaveLength(1);
	});

	it("answers not live when the index still names an email whose row is gone on the consistent read", async () => {
		const { isAccountLive } = fakeUsersTable({ indexed: { email: "reader@example.com" } });

		expect(await isAccountLive(userId)).toBe(false);
	});

	it("answers not live when the email was re-registered under another user id", async () => {
		const { isAccountLive } = fakeUsersTable({
			indexed: { email: "reader@example.com" },
			byEmail: { userId: "user-2" },
		});

		expect(await isAccountLive(userId)).toBe(false);
	});

	it("reads the users row by email with a consistent read", async () => {
		const { isAccountLive, sent } = fakeUsersTable({
			indexed: { email: "reader@example.com" },
			byEmail: { userId: "user-1" },
		});

		await isAccountLive(userId);

		expect(sent[1]).toMatchObject({
			TableName: USERS_TABLE,
			Key: { email: "reader@example.com" },
			ConsistentRead: true,
		});
	});

	it("finds the email through one row of the userId-index", async () => {
		const { isAccountLive, sent } = fakeUsersTable({});

		await isAccountLive(userId);

		expect(sent[0]).toMatchObject({
			TableName: USERS_TABLE,
			IndexName: "userId-index",
			ExpressionAttributeValues: { ":userId": "user-1" },
			Limit: 1,
		});
	});
});
