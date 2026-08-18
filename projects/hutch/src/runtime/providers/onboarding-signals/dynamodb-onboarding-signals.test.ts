import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initOnboardingSignals } from "./dynamodb-onboarding-signals";

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
	return initOnboardingSignals({ client, onboardingTableName: "onboarding", now: () => NOW });
}

function updateOf(commands: CapturedCommand[]): CapturedCommand | undefined {
	return commands.find((c) => c.name === "UpdateCommand");
}

describe("initOnboardingSignals", () => {
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

	describe("recordNextReadMinimumReached", () => {
		it("upserts the milestone timestamp (set-once) keyed directly by userId", async () => {
			const { client, commands } = createFakeClient({});

			await initSignal(client).recordNextReadMinimumReached({ userId: USER });

			const update = updateOf(commands);
			expect(update?.input.Key).toEqual({ userId: "user-1" });
			expect(update?.input.UpdateExpression).toBe(
				"SET nextReadMinimumReachedAt = if_not_exists(nextReadMinimumReachedAt, :now)",
			);
			expect((update?.input.ExpressionAttributeValues as Record<string, unknown>)[":now"]).toBe(
				NOW.toISOString(),
			);
		});
	});

	describe("getOnboardingSignals", () => {
		it("reads by userId and returns both false when no row exists for the user", async () => {
			const { client, commands } = createFakeClient({});

			const signals = await initSignal(client).getOnboardingSignals({ userId: USER });

			expect(commands.find((c) => c.name === "GetCommand")?.input.Key).toEqual({ userId: "user-1" });
			expect(signals).toEqual({
				installed: false,
				savedArticle: false,
				nextReadMinimumReachedAt: undefined,
			});
		});

		it("returns installed=true and savedArticle=false once only activation is recorded", async () => {
			const { client } = createFakeClient({
				row: { userId: "user-1", iosAppActivatedAt: "2026-06-23T09:00:00.000Z" },
			});

			const signals = await initSignal(client).getOnboardingSignals({ userId: USER });

			expect(signals).toEqual({
				installed: true,
				savedArticle: false,
				nextReadMinimumReachedAt: undefined,
			});
		});

		it("returns both true once a save has been recorded", async () => {
			const { client } = createFakeClient({
				row: {
					userId: "user-1",
					iosAppActivatedAt: "2026-06-23T09:00:00.000Z",
					iosAppSavedAt: "2026-06-23T09:30:00.000Z",
				},
			});

			const signals = await initSignal(client).getOnboardingSignals({ userId: USER });

			expect(signals).toEqual({
				installed: true,
				savedArticle: true,
				nextReadMinimumReachedAt: undefined,
			});
		});

		it("surfaces the Next Read milestone instant once the row carries it", async () => {
			const { client } = createFakeClient({
				row: { userId: "user-1", nextReadMinimumReachedAt: "2026-06-20T08:15:00.000Z" },
			});

			const signals = await initSignal(client).getOnboardingSignals({ userId: USER });

			expect(signals.nextReadMinimumReachedAt).toEqual(
				new Date("2026-06-20T08:15:00.000Z"),
			);
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
