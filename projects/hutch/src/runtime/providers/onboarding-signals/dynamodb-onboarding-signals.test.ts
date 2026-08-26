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
	describe("recordNativeAppAnyActivity", () => {
		it("upserts the activation timestamp (set-once) keyed directly by userId", async () => {
			const { client, commands } = createFakeClient({});

			await initSignal(client).recordNativeAppAnyActivity({ userId: USER, platform: "ios" });

			const update = updateOf(commands);
			expect(update?.input.Key).toEqual({ userId: "user-1" });
			expect(update?.input.UpdateExpression).toBe(
				"SET #activated = if_not_exists(#activated, :now)",
			);
			expect(update?.input.ExpressionAttributeNames).toEqual({ "#activated": "iosAppActivatedAt" });
			expect((update?.input.ExpressionAttributeValues as Record<string, unknown>)[":now"]).toBe(
				NOW.toISOString(),
			);
		});
	});

	describe("recordNativeAppSavedArticle", () => {
		it("sets both the activation and saved timestamps (set-once) keyed by userId", async () => {
			const { client, commands } = createFakeClient({});

			await initSignal(client).recordNativeAppSavedArticle({ userId: USER, platform: "ios" });

			const update = updateOf(commands);
			expect(update?.input.Key).toEqual({ userId: "user-1" });
			expect(update?.input.UpdateExpression).toBe(
				"SET #activated = if_not_exists(#activated, :now), #saved = if_not_exists(#saved, :now)",
			);
			expect(update?.input.ExpressionAttributeNames).toEqual({
				"#activated": "iosAppActivatedAt",
				"#saved": "iosAppSavedAt",
			});
		});

		it("writes the Android attributes, never the iOS ones, for an Android save", async () => {
			const { client, commands } = createFakeClient({});

			await initSignal(client).recordNativeAppSavedArticle({ userId: USER, platform: "android" });

			expect(updateOf(commands)?.input.ExpressionAttributeNames).toEqual({
				"#activated": "androidAppActivatedAt",
				"#saved": "androidAppSavedAt",
			});
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

	describe("recordNextReadStepOutstanding", () => {
		it("upserts the outstanding marker (set-once) keyed directly by userId", async () => {
			const { client, commands } = createFakeClient({});

			await initSignal(client).recordNextReadStepOutstanding({ userId: USER });

			const update = updateOf(commands);
			expect(update?.input.Key).toEqual({ userId: "user-1" });
			expect(update?.input.UpdateExpression).toBe(
				"SET nextReadStepOutstandingAt = if_not_exists(nextReadStepOutstandingAt, :now)",
			);
		});
	});

	describe("recordMarkReadAcrossQueuesAcknowledged", () => {
		it("upserts the acknowledgement (set-once) keyed directly by userId", async () => {
			const { client, commands } = createFakeClient({});

			await initSignal(client).recordMarkReadAcrossQueuesAcknowledged({ userId: USER });

			const update = updateOf(commands);
			expect(update?.input.Key).toEqual({ userId: "user-1" });
			expect(update?.input.UpdateExpression).toBe(
				"SET markReadAcrossQueuesAckedAt = if_not_exists(markReadAcrossQueuesAckedAt, :now)",
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
				nativeApp: {
					ios: { installed: false, savedArticle: false },
					android: { installed: false, savedArticle: false },
				},
				nextReadMinimumReachedAt: undefined,
				nextReadStepOutstandingAt: undefined,
				markReadAcrossQueuesAckedAt: undefined,
			});
		});

		it("returns installed=true and savedArticle=false once only activation is recorded", async () => {
			const { client } = createFakeClient({
				row: { userId: "user-1", iosAppActivatedAt: "2026-06-23T09:00:00.000Z" },
			});

			const signals = await initSignal(client).getOnboardingSignals({ userId: USER });

			expect(signals).toEqual({
				nativeApp: {
					ios: { installed: true, savedArticle: false },
					android: { installed: false, savedArticle: false },
				},
				nextReadMinimumReachedAt: undefined,
				nextReadStepOutstandingAt: undefined,
				markReadAcrossQueuesAckedAt: undefined,
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
				nativeApp: {
					ios: { installed: true, savedArticle: true },
					android: { installed: false, savedArticle: false },
				},
				nextReadMinimumReachedAt: undefined,
				nextReadStepOutstandingAt: undefined,
				markReadAcrossQueuesAckedAt: undefined,
			});
		});

		it("reads each app's own attributes, so an Android row never ticks the iPhone steps", async () => {
			const { client } = createFakeClient({
				row: {
					userId: "user-1",
					androidAppActivatedAt: "2026-06-23T09:00:00.000Z",
					androidAppSavedAt: "2026-06-23T09:30:00.000Z",
				},
			});

			const signals = await initSignal(client).getOnboardingSignals({ userId: USER });

			expect(signals.nativeApp).toEqual({
				ios: { installed: false, savedArticle: false },
				android: { installed: true, savedArticle: true },
			});
		});

		it("surfaces the outstanding marker once the row carries it", async () => {
			const { client } = createFakeClient({
				row: { userId: "user-1", nextReadStepOutstandingAt: "2026-06-19T08:15:00.000Z" },
			});

			const signals = await initSignal(client).getOnboardingSignals({ userId: USER });

			expect(signals.nextReadStepOutstandingAt).toEqual(
				new Date("2026-06-19T08:15:00.000Z"),
			);
		});

		it("surfaces the mark-read acknowledgement once the row carries it", async () => {
			const { client } = createFakeClient({
				row: { userId: "user-1", markReadAcrossQueuesAckedAt: "2026-06-21T08:15:00.000Z" },
			});

			const signals = await initSignal(client).getOnboardingSignals({ userId: USER });

			expect(signals.markReadAcrossQueuesAckedAt).toEqual(
				new Date("2026-06-21T08:15:00.000Z"),
			);
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
