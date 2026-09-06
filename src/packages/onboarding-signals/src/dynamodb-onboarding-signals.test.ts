import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initOnboardingSignals } from "./dynamodb-onboarding-signals";

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

/** Records commands and replays a single fetched row (or none) for GetCommand. */
function createFakeClient(opts: { row?: Record<string, unknown>; updateError?: Error }): {
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
			if (name === "UpdateCommand" && opts.updateError) {
				throw opts.updateError;
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

	describe("recordInboxArticleQueued", () => {
		it("upserts the first inbox article instant (set-once) keyed directly by userId", async () => {
			const { client, commands } = createFakeClient({});

			await initSignal(client).recordInboxArticleQueued({ userId: USER });

			const update = updateOf(commands);
			expect(update?.input.Key).toEqual({ userId: "user-1" });
			expect(update?.input.UpdateExpression).toBe(
				"SET firstInboxArticleQueuedAt = if_not_exists(firstInboxArticleQueuedAt, :now)",
			);
			expect((update?.input.ExpressionAttributeValues as Record<string, unknown>)[":now"]).toBe(
				NOW.toISOString(),
			);
		});
	});

	describe("recordEmailStepMarkedDone", () => {
		it("upserts the marked-done instant (set-once) keyed directly by userId", async () => {
			const { client, commands } = createFakeClient({});

			await initSignal(client).recordEmailStepMarkedDone({ userId: USER });

			const update = updateOf(commands);
			expect(update?.input.Key).toEqual({ userId: "user-1" });
			expect(update?.input.UpdateExpression).toBe(
				"SET emailStepMarkedDoneAt = if_not_exists(emailStepMarkedDoneAt, :now)",
			);
			expect((update?.input.ExpressionAttributeValues as Record<string, unknown>)[":now"]).toBe(
				NOW.toISOString(),
			);
		});
	});

	describe("recordOnboardingOutstandingVersion", () => {
		it("overwrites the outstanding version with a plain SET keyed by userId", async () => {
			const { client, commands } = createFakeClient({});

			await initSignal(client).recordOnboardingOutstandingVersion({
				userId: USER,
				version: "0badf00d",
			});

			const update = updateOf(commands);
			expect(update?.input.Key).toEqual({ userId: "user-1" });
			expect(update?.input.UpdateExpression).toBe("SET onboardingOutstandingVersion = :version");
			expect(
				(update?.input.ExpressionAttributeValues as Record<string, unknown>)[":version"],
			).toBe("0badf00d");
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

	describe("recordDeleteArticleAcknowledged", () => {
		it("upserts the acknowledgement (set-once) keyed directly by userId", async () => {
			const { client, commands } = createFakeClient({});

			await initSignal(client).recordDeleteArticleAcknowledged({ userId: USER });

			const update = updateOf(commands);
			expect(update?.input.Key).toEqual({ userId: "user-1" });
			expect(update?.input.UpdateExpression).toBe(
				"SET deleteArticleAckedAt = if_not_exists(deleteArticleAckedAt, :now)",
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
				firstInboxArticleQueuedAt: undefined,
				emailStepMarkedDoneAt: undefined,
				onboardingOutstandingVersion: undefined,
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
				firstInboxArticleQueuedAt: undefined,
				emailStepMarkedDoneAt: undefined,
				onboardingOutstandingVersion: undefined,
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
				firstInboxArticleQueuedAt: undefined,
				emailStepMarkedDoneAt: undefined,
				onboardingOutstandingVersion: undefined,
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

		it("surfaces the first inbox article instant once the row carries it", async () => {
			const { client } = createFakeClient({
				row: { userId: "user-1", firstInboxArticleQueuedAt: "2026-09-04T08:15:00.000Z" },
			});

			const signals = await initSignal(client).getOnboardingSignals({ userId: USER });

			expect(signals.firstInboxArticleQueuedAt).toEqual(new Date("2026-09-04T08:15:00.000Z"));
		});

		it("surfaces the email marked-done instant once the row carries it", async () => {
			const { client } = createFakeClient({
				row: { userId: "user-1", emailStepMarkedDoneAt: "2026-09-05T08:15:00.000Z" },
			});

			const signals = await initSignal(client).getOnboardingSignals({ userId: USER });

			expect(signals.emailStepMarkedDoneAt).toEqual(new Date("2026-09-05T08:15:00.000Z"));
		});

		it("surfaces the outstanding version as the stored string, not a Date", async () => {
			const { client } = createFakeClient({
				row: { userId: "user-1", onboardingOutstandingVersion: "0badf00d" },
			});

			const signals = await initSignal(client).getOnboardingSignals({ userId: USER });

			expect(signals.onboardingOutstandingVersion).toBe("0badf00d");
		});

		it("ignores the retired nextReadStepOutstandingAt attribute on a legacy row", async () => {
			const { client } = createFakeClient({
				row: { userId: "user-1", nextReadStepOutstandingAt: "2026-06-19T08:15:00.000Z" },
			});

			const signals = await initSignal(client).getOnboardingSignals({ userId: USER });

			expect(signals.firstInboxArticleQueuedAt).toBeUndefined();
			expect(signals.onboardingOutstandingVersion).toBeUndefined();
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

		it("surfaces the delete acknowledgement once the row carries it", async () => {
			const { client } = createFakeClient({
				row: { userId: "user-1", deleteArticleAckedAt: "2026-06-22T08:15:00.000Z" },
			});

			const signals = await initSignal(client).getOnboardingSignals({ userId: USER });

			expect(signals.deleteArticleAckedAt).toEqual(new Date("2026-06-22T08:15:00.000Z"));
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

	describe("markFirstInboxEmailNoticeSent", () => {
		it("claims the marker with a guarded set-once Update keyed by userId", async () => {
			const { client, commands } = createFakeClient({});

			const claim = await initSignal(client).markFirstInboxEmailNoticeSent({
				userId: USER,
				sentAt: "2026-09-03T10:00:00.000Z",
			});

			expect(claim).toBe("claimed");
			const update = updateOf(commands);
			expect(update?.input.Key).toEqual({ userId: "user-1" });
			expect(update?.input.UpdateExpression).toContain(
				"SET firstInboxEmailNoticeSentAt = :sentAt",
			);
			expect(update?.input.ConditionExpression).toContain(
				"attribute_not_exists(firstInboxEmailNoticeSentAt)",
			);
			expect(
				(update?.input.ExpressionAttributeValues as Record<string, unknown>)[":sentAt"],
			).toBe("2026-09-03T10:00:00.000Z");
		});

		it("reports already-sent when a concurrent delivery took the marker first", async () => {
			const { client } = createFakeClient({
				updateError: new ConditionalCheckFailedException({
					message: "The conditional request failed",
					$metadata: {},
				}),
			});

			const claim = await initSignal(client).markFirstInboxEmailNoticeSent({
				userId: USER,
				sentAt: "2026-09-03T10:00:00.000Z",
			});

			expect(claim).toBe("already-sent");
		});

		it("propagates a fault that is not the claim being lost", async () => {
			const { client } = createFakeClient({ updateError: new Error("throttled") });

			await expect(
				initSignal(client).markFirstInboxEmailNoticeSent({
					userId: USER,
					sentAt: "2026-09-03T10:00:00.000Z",
				}),
			).rejects.toThrow("throttled");
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
