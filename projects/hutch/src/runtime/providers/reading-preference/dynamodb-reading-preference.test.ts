import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initReadingPreference } from "./dynamodb-reading-preference";

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

function createFakeClient(opts: { row?: Record<string, unknown> }): {
	client: DynamoDBDocumentClient;
	commands: CapturedCommand[];
} {
	const commands: CapturedCommand[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (name === "GetCommand") {
				return { Item: opts.row };
			}
			return {};
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

const USER = UserIdSchema.parse("user-1");
const NOW = new Date("2026-07-27T10:00:00.000Z");

function initPreference(client: DynamoDBDocumentClient) {
	return initReadingPreference({ client, tableName: "reading-preferences", now: () => NOW });
}

describe("initReadingPreference", () => {
	describe("saveReadingPreference", () => {
		it("writes the whole row so a re-save replaces the previous text and timestamp", async () => {
			const { client, commands } = createFakeClient({});

			await initPreference(client).saveReadingPreference({
				userId: USER,
				text: "Long-form essays about systems design",
			});

			const put = commands.find((c) => c.name === "PutCommand");
			expect(put?.input.TableName).toBe("reading-preferences");
			expect(put?.input.Item).toEqual({
				userId: "user-1",
				preferenceText: "Long-form essays about systems design",
				updatedAt: NOW.toISOString(),
			});
		});
	});

	describe("getReadingPreference", () => {
		it("reads by the userId PK and returns undefined when the user has never saved one", async () => {
			const { client, commands } = createFakeClient({});

			const preference = await initPreference(client).getReadingPreference({ userId: USER });

			expect(commands.find((c) => c.name === "GetCommand")?.input.Key).toEqual({
				userId: "user-1",
			});
			expect(preference).toBeUndefined();
		});

		it("maps the stored row onto the text and updatedAt the caller renders", async () => {
			const { client } = createFakeClient({
				row: {
					userId: "user-1",
					preferenceText: "Deep dives on distributed systems",
					updatedAt: "2026-07-26T08:30:00.000Z",
				},
			});

			const preference = await initPreference(client).getReadingPreference({ userId: USER });

			expect(preference).toEqual({
				text: "Deep dives on distributed systems",
				updatedAt: "2026-07-26T08:30:00.000Z",
			});
		});
	});

	describe("deleteReadingPreference", () => {
		it("deletes the single preference row by the userId PK", async () => {
			const { client, commands } = createFakeClient({});

			await initPreference(client).deleteReadingPreference({ userId: USER });

			const del = commands.find((c) => c.name === "DeleteCommand");
			expect(del?.input.Key).toEqual({ userId: "user-1" });
		});
	});
});
