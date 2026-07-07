import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initIosOnboardingSignal } from "./dynamodb-ios-onboarding-signal";

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

/** Records commands and replays a single fetched row (or none) for GetCommand. */
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
const NOW = new Date("2026-06-23T10:00:00.000Z");

function initSignal(client: DynamoDBDocumentClient) {
	return initIosOnboardingSignal({ client, onboardingTableName: "onboarding", now: () => NOW });
}

function updateOf(commands: CapturedCommand[]): CapturedCommand | undefined {
	return commands.find((c) => c.name === "UpdateCommand");
}

describe("initIosOnboardingSignal", () => {
	describe("recordIosAnyActivity", () => {
		it("upserts the activation timestamp (set-once) keyed directly by userId", async () => {
			const { client, commands } = createFakeClient({});

			await initSignal(client).recordIosAnyActivity({ userId: USER });

			const update = updateOf(commands);
			expect(update?.input.Key).toEqual({ userId: "user-1" });
			expect(update?.input.UpdateExpression).toBe(
				"SET iosAppActivatedAt = if_not_exists(iosAppActivatedAt, :now)",
			);
			expect((update?.input.ExpressionAttributeValues as Record<string, unknown>)[":now"]).toBe(
				NOW.toISOString(),
			);
		});
	});

	describe("recordIosSavedArticle", () => {
		it("sets both the activation and saved timestamps (set-once) keyed by userId", async () => {
			const { client, commands } = createFakeClient({});

			await initSignal(client).recordIosSavedArticle({ userId: USER });

			const update = updateOf(commands);
			expect(update?.input.Key).toEqual({ userId: "user-1" });
			expect(update?.input.UpdateExpression).toBe(
				"SET iosAppActivatedAt = if_not_exists(iosAppActivatedAt, :now), iosAppSavedAt = if_not_exists(iosAppSavedAt, :now)",
			);
		});
	});

	describe("getIosAppSignals", () => {
		it("reads by userId and returns both false when no row exists for the user", async () => {
			const { client, commands } = createFakeClient({});

			const signals = await initSignal(client).getIosAppSignals({ userId: USER });

			expect(commands.find((c) => c.name === "GetCommand")?.input.Key).toEqual({ userId: "user-1" });
			expect(signals).toEqual({ installed: false, savedArticle: false });
		});

		it("returns installed=true and savedArticle=false once only activation is recorded", async () => {
			const { client } = createFakeClient({
				row: { userId: "user-1", iosAppActivatedAt: "2026-06-23T09:00:00.000Z" },
			});

			const signals = await initSignal(client).getIosAppSignals({ userId: USER });

			expect(signals).toEqual({ installed: true, savedArticle: false });
		});

		it("returns both true once a save has been recorded", async () => {
			const { client } = createFakeClient({
				row: {
					userId: "user-1",
					iosAppActivatedAt: "2026-06-23T09:00:00.000Z",
					iosAppSavedAt: "2026-06-23T09:30:00.000Z",
				},
			});

			const signals = await initSignal(client).getIosAppSignals({ userId: USER });

			expect(signals).toEqual({ installed: true, savedArticle: true });
		});
	});

	describe("deleteOnboarding", () => {
		it("deletes the single onboarding row by the userId PK", async () => {
			const { client, commands } = createFakeClient({});

			await initSignal(client).deleteOnboarding({ userId: USER });

			const del = commands.find((c) => c.name === "DeleteCommand");
			expect(del?.input.Key).toEqual({ userId: "user-1" });
		});
	});
});
