import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initIosOnboardingSignal } from "./dynamodb-ios-onboarding-signal";

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

/** Records commands and replays a single queried user row (or none). */
function createFakeClient(opts: { row?: Record<string, unknown> }): {
	client: DynamoDBDocumentClient;
	commands: CapturedCommand[];
} {
	const commands: CapturedCommand[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (name === "QueryCommand") {
				return { Items: opts.row ? [opts.row] : [], Count: opts.row ? 1 : 0 };
			}
			return {};
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

const USER = UserIdSchema.parse("user-1");
const NOW = new Date("2026-06-23T10:00:00.000Z");
const ROW = { email: "user@example.com", userId: "user-1" };

function initSignal(client: DynamoDBDocumentClient) {
	return initIosOnboardingSignal({ client, usersTableName: "users", now: () => NOW });
}

function updateOf(commands: CapturedCommand[]): CapturedCommand | undefined {
	return commands.find((c) => c.name === "UpdateCommand");
}

describe("initIosOnboardingSignal", () => {
	describe("recordIosAppActivity", () => {
		it("resolves the row's email key via the userId-index", async () => {
			const { client, commands } = createFakeClient({ row: ROW });

			await initSignal(client).recordIosAppActivity({ userId: USER, savedArticle: false });

			expect(commands.find((c) => c.name === "QueryCommand")?.input.IndexName).toBe("userId-index");
			expect(updateOf(commands)?.input.Key).toEqual({ email: "user@example.com" });
		});

		it("sets only the activation timestamp (set-once) when savedArticle is false", async () => {
			const { client, commands } = createFakeClient({ row: ROW });

			await initSignal(client).recordIosAppActivity({ userId: USER, savedArticle: false });

			const update = updateOf(commands);
			expect(update?.input.UpdateExpression).toBe(
				"SET iosAppActivatedAt = if_not_exists(iosAppActivatedAt, :now)",
			);
			expect((update?.input.ExpressionAttributeValues as Record<string, unknown>)[":now"]).toBe(
				NOW.toISOString(),
			);
		});

		it("also sets the saved timestamp (set-once) when savedArticle is true", async () => {
			const { client, commands } = createFakeClient({ row: ROW });

			await initSignal(client).recordIosAppActivity({ userId: USER, savedArticle: true });

			expect(updateOf(commands)?.input.UpdateExpression).toBe(
				"SET iosAppActivatedAt = if_not_exists(iosAppActivatedAt, :now), iosAppSavedAt = if_not_exists(iosAppSavedAt, :now)",
			);
		});
	});

	describe("getIosAppSignals", () => {
		it("returns both false when no row exists for the user", async () => {
			const { client } = createFakeClient({});

			const signals = await initSignal(client).getIosAppSignals({ userId: USER });

			expect(signals).toEqual({ installed: false, savedArticle: false });
		});

		it("returns installed=true and savedArticle=false once only activation is recorded", async () => {
			const { client } = createFakeClient({
				row: { ...ROW, iosAppActivatedAt: "2026-06-23T09:00:00.000Z" },
			});

			const signals = await initSignal(client).getIosAppSignals({ userId: USER });

			expect(signals).toEqual({ installed: true, savedArticle: false });
		});

		it("returns both true once a save has been recorded", async () => {
			const { client } = createFakeClient({
				row: {
					...ROW,
					iosAppActivatedAt: "2026-06-23T09:00:00.000Z",
					iosAppSavedAt: "2026-06-23T09:30:00.000Z",
				},
			});

			const signals = await initSignal(client).getIosAppSignals({ userId: USER });

			expect(signals).toEqual({ installed: true, savedArticle: true });
		});
	});
});
