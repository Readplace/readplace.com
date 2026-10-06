import assert from "node:assert/strict";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import {
	ConditionalCheckFailedException,
	TransactionCanceledException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import type {
	EngagementState,
	StarterPack,
	FrozenStarterMessage,
} from "@packages/provider-contracts/engagement-starter";
import {
	initDynamoDbEngagementActivity,
	initDynamoDbEngagementStarter,
} from "./dynamodb-engagement-starter";

const userId = UserIdSchema.parse("reader");
const now = new Date("2026-10-10T12:00:00.000Z");
const assignment = {
	campaignId: "hn-starter-v1",
	arm: "treatment" as const,
	assignedAt: now.toISOString(),
	tier: "trial" as const,
	accountCohort: "existing" as const,
};
const pack: StarterPack = {
	campaignId: assignment.campaignId,
	readlist: ReadlistSlugSchema.parse("hn-picks"),
	readlistLabel: "Hacker News picks",
	selectedAt: now.toISOString(),
	emailStatus: "pending",
	picks: Array.from({ length: 10 }, (_, rank) => ({
		url: `https://publisher.com/${rank}`,
		hnItemId: 100 + rank,
		rank: rank + 1,
		snapshotAt: now.toISOString(),
	})),
};
const message: FrozenStarterMessage = {
	from: "from",
	to: "recipient@publisher.com",
	replyTo: "reply",
	subject: "Subject",
	html: "<p>Body</p>",
	text: "Body",
	headers: {},
	idempotencyKey: "starter/reader",
};
type Response = Record<string, unknown> | Error;
function subject(responses: Response[] = []) {
	const commands: { name: string; input: Record<string, unknown> }[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			commands.push({ name: command.constructor.name, input: command.input });
			const response = responses.shift() ?? {};
			if (response instanceof Error) throw response;
			return response;
		}) as DynamoDBDocumentClient["send"],
	};
	return {
		commands,
		store: initDynamoDbEngagementStarter({
			client: client as typeof client & DynamoDBDocumentClient,
			onboardingTableName: "onboarding",
			notificationsTableName: "notifications",
			userArticlesTableName: "library",
		}),
		activity: initDynamoDbEngagementActivity({
			client: client as typeof client & DynamoDBDocumentClient,
			onboardingTableName: "onboarding",
		}),
	};
}
const conflict = () => new ConditionalCheckFailedException({ message: "conflict", $metadata: {} });
const cancelled = (Code?: string) =>
	new TransactionCanceledException({
		message: "cancelled",
		$metadata: {},
		CancellationReasons: Code === undefined ? undefined : [{ Code }],
	});

describe("persistent engagement state", () => {
	it("starts observation once and retries a concurrent revision without resetting the clock", async () => {
		const existing = { activityRevision: 4, observationStartedAt: "2026-10-01T12:00:00.000Z" };
		const app = subject([
			{},
			{},
			{ Item: { engagement: existing } },
			conflict(),
			{ Item: { engagement: existing } },
			{},
		]);
		expect(await app.store.observeEngagement({ userId, startedAt: now.toISOString() })).toEqual({
			activityRevision: 1,
			observationStartedAt: now.toISOString(),
		});
		expect(await app.store.observeEngagement({ userId, startedAt: now.toISOString() })).toEqual({
			...existing,
			activityRevision: 5,
		});
		expect(app.commands[0]?.input.ConsistentRead).toBe(true);
		expect(app.commands[1]?.input.ConditionExpression).toContain(
			"engagement.activityRevision = :revision",
		);
	});
	it("keeps activity monotonic and records primary and days eight-to-fourteen outcomes once", async () => {
		const base: EngagementState = { activityRevision: 3, assignment };
		for (const kind of [
			"personal-save",
			"mcp-content",
			"mcp-summary",
			"read-status",
			"reader-open",
			"summary-open",
			"import-request",
		] as const) {
			const app = subject([{ Item: { engagement: base } }, {}]);
			await app.store.recordEngagementActivity({ userId, kind, at: now, markedRead: true });
			const state = z
				.object({
					":state": z.object({
						lastActivityAt: z.string(),
						activatedAt: z.string().optional(),
						activityRevision: z.number(),
					}),
				})
				.parse(app.commands[1]?.input.ExpressionAttributeValues)[":state"];
			expect(state.lastActivityAt).toBe(now.toISOString());
			expect(state.activityRevision).toBe(4);
			expect(state.activatedAt !== undefined).toBe(
				["personal-save", "mcp-content", "mcp-summary", "read-status"].includes(kind),
			);
		}
		const later = new Date(now.getTime() + 8 * 86_400_000);
		const already: EngagementState = {
			...base,
			activatedAt: now.toISOString(),
			engagedDays8To14At: later.toISOString(),
			lastActivityAt: later.toISOString(),
		};
		for (const [state, at] of [
			[base, later],
			[already, now],
			[{ activityRevision: 0 }, now],
			[base, new Date(now.getTime() + 14 * 86_400_000)],
			[already, later],
		] satisfies Array<[EngagementState, Date]>) {
			const app = subject([{ Item: { engagement: state } }, {}]);
			await app.store.recordEngagementActivity({
				userId,
				kind: "read-status",
				markedRead: false,
				at,
			});
			const next = z
				.object({
					":state": z.object({
						lastActivityAt: z.string(),
						engagedDays8To14At: z.string().optional(),
					}),
				})
				.parse(app.commands[1]?.input.ExpressionAttributeValues)[":state"];
			expect(next.lastActivityAt).toBe(
				state.lastActivityAt !== undefined && state.lastActivityAt > at.toISOString()
					? state.lastActivityAt
					: at.toISOString(),
			);
			if (at === later) expect(next.engagedDays8To14At).toBe(later.toISOString());
		}
	});
	it("records activity through the onboarding table alone", async () => {
		const app = subject();
		await app.activity.recordEngagementActivity({ userId, kind: "personal-save", at: now });
		expect(app.commands.map((command) => command.input.TableName)).toEqual([
			"onboarding",
			"onboarding",
		]);
		expect(app.commands[1]?.input.ExpressionAttributeValues).toMatchObject({
			":state": { activityRevision: 1, lastActivityAt: now.toISOString() },
		});
	});
	it("propagates operational update failures", async () => {
		const error = new Error("offline");
		await expect(
			subject([{}, error]).store.recordEngagementActivity({ userId, at: now, kind: "reader-open" }),
		).rejects.toBe(error);
	});
	it.each([
		"treatment",
		"comparison",
	] as const)("permanently assigns %s at a conditional boundary", async (arm) => {
		const app = subject();
		expect(
			await app.store.assignStarter({
				userId,
				revision: 3,
				assignment: { ...assignment, arm },
				pack,
			}),
		).toBe("assigned");
		const transaction = z
			.object({
				TransactItems: z.array(
					z.object({
						Update: z.object({
							UpdateExpression: z.string(),
							ConditionExpression: z.string(),
							ExpressionAttributeValues: z.record(z.string(), z.unknown()),
						}),
					}),
				),
			})
			.parse(app.commands[0]?.input);
		expect(transaction.TransactItems).toHaveLength(arm === "treatment" ? 2 : 1);
		expect(transaction.TransactItems[0]?.Update.ConditionExpression).toContain(
			"attribute_not_exists(engagement.assignment)",
		);
		expect(transaction.TransactItems[0]?.Update.UpdateExpression).toContain(
			"starterCampaignId = :campaign",
		);
		expect(transaction.TransactItems[0]?.Update.ExpressionAttributeValues[":campaign"]).toBe(
			assignment.campaignId,
		);
	});
	it("distinguishes conflicts from capacity or other transaction failures", async () => {
		expect(
			await subject([cancelled("ConditionalCheckFailed")]).store.assignStarter({
				userId,
				revision: 0,
				assignment,
				pack,
			}),
		).toBe("conflict");
		for (const error of [
			new Error("offline"),
			cancelled(),
			cancelled("ProvisionedThroughputExceeded"),
		])
			await expect(
				subject([error]).store.assignStarter({ userId, revision: 0, assignment, pack }),
			).rejects.toBe(error);
	});
	it("queries the campaign's assigned accounts page by page and loads their packs in one batch", async () => {
		const state = { activityRevision: 1, assignment };
		const other = UserIdSchema.parse("other-reader");
		const app = subject([
			{
				Items: [{ userId, engagement: state, starterCampaignId: assignment.campaignId }],
				LastEvaluatedKey: { userId },
			},
			{ Items: [{ userId: other, engagement: state, starterCampaignId: assignment.campaignId }] },
			{ Responses: { notifications: [{ userId: other, starterPack: pack }] } },
		]);
		expect(await app.store.listStarterObservations(assignment.campaignId)).toEqual([
			{ userId, engagement: state, starterPack: undefined },
			{ userId: other, engagement: state, starterPack: pack },
		]);
		expect(app.commands.map((command) => command.name)).toEqual([
			"QueryCommand",
			"QueryCommand",
			"BatchGetCommand",
		]);
		expect(app.commands[0]?.input).toMatchObject({
			TableName: "onboarding",
			IndexName: "starterCampaignId-index",
			KeyConditionExpression: "starterCampaignId = :campaign",
			ExpressionAttributeValues: { ":campaign": assignment.campaignId },
		});
		expect(app.commands[1]?.input.ExclusiveStartKey).toEqual({ userId });
		expect(app.commands[2]?.input).toMatchObject({
			RequestItems: { notifications: { Keys: [{ userId }, { userId: other }] } },
		});
		expect(app.commands.filter((command) => command.input.ConsistentRead === true)).toEqual([]);
	});
});

describe("withdrawal on account deletion", () => {
	const withdrawal = z.object({
		TransactItems: z.array(
			z.object({
				Update: z.object({
					TableName: z.string(),
					Key: z.object({ userId: z.string() }),
					UpdateExpression: z.string(),
					ConditionExpression: z.string(),
					ExpressionAttributeValues: z.record(z.string(), z.unknown()).optional(),
				}),
			}),
		),
	});
	const assignedState = {
		activityRevision: 4,
		observationStartedAt: "2026-10-01T12:00:00.000Z",
		lastActivityAt: now.toISOString(),
		activatedAt: now.toISOString(),
		assignment,
	};
	it("moves the assignment and outcome to an anonymous account and clears the deleted account's assignment in one transaction", async () => {
		const delivered = {
			...pack,
			insertedAt: now.toISOString(),
			insertionOutcome: "inserted" as const,
			emailStatus: "sent" as const,
			message,
			sentAt: now.toISOString(),
		};
		const app = subject([{ Item: { engagement: assignedState } }, { Item: { starterPack: delivered } }, {}]);

		await app.store.withdrawStarterAssignment(userId);

		const [account, anonymousAccount, anonymousOutcome] = withdrawal
			.parse(app.commands[2]?.input)
			.TransactItems.map((item) => item.Update);
		const { message: _message, ...outcome } = delivered;
		expect(account).toEqual({
			TableName: "onboarding",
			Key: { userId },
			UpdateExpression: "REMOVE engagement, starterCampaignId",
			ConditionExpression: "engagement.activityRevision = :revision",
			ExpressionAttributeValues: { ":revision": 4 },
		});
		expect(anonymousAccount?.Key.userId).not.toBe(userId);
		expect(anonymousAccount).toMatchObject({
			TableName: "onboarding",
			UpdateExpression: "SET engagement = :engagement, starterCampaignId = :campaign",
			ConditionExpression: "attribute_not_exists(userId)",
			ExpressionAttributeValues: {
				":engagement": { activityRevision: 0, assignment, activatedAt: now.toISOString() },
				":campaign": assignment.campaignId,
			},
		});
		expect(anonymousOutcome).toEqual({
			TableName: "notifications",
			Key: anonymousAccount?.Key,
			UpdateExpression: "SET starterPack = :pack",
			ConditionExpression: "attribute_not_exists(userId)",
			ExpressionAttributeValues: { ":pack": { ...outcome, picks: [] } },
		});
	});
	it("withdraws a comparison account, which holds no pack, without an outcome row", async () => {
		const app = subject([{ Item: { engagement: assignedState } }, {}, {}]);

		await app.store.withdrawStarterAssignment(userId);

		expect(withdrawal.parse(app.commands[2]?.input).TransactItems).toHaveLength(2);
	});
	it("does nothing for an account without an assignment, so a redelivered deletion adds no second outcome", async () => {
		const app = subject([{ Item: { engagement: { activityRevision: 0 } } }]);

		await app.store.withdrawStarterAssignment(userId);

		expect(app.commands.map((command) => command.name)).toEqual(["GetCommand"]);
	});
	it("rereads after concurrent activity and propagates operational failures", async () => {
		const app = subject([
			{ Item: { engagement: assignedState } },
			{},
			cancelled("ConditionalCheckFailed"),
			{ Item: { engagement: { ...assignedState, activityRevision: 5 } } },
			{},
			{},
		]);

		await app.store.withdrawStarterAssignment(userId);

		expect(withdrawal.parse(app.commands[5]?.input).TransactItems[0]?.Update.ExpressionAttributeValues).toEqual({
			":revision": 5,
		});
		const error = cancelled("ProvisionedThroughputExceeded");
		await expect(
			subject([{ Item: { engagement: assignedState } }, {}, error]).store.withdrawStarterAssignment(userId),
		).rejects.toBe(error);
	});
});

describe("atomic starter insertion", () => {
	it("persists failure outcomes without altering an inserted marker", async () => {
		const input = { userId, selectedAt: pack.selectedAt, at: now, outcome: "failed" as const };
		const app = subject();
		await app.store.recordStarterInsertionFailure(input);
		expect(app.commands[0]?.input.ConditionExpression).toContain(
			"attribute_not_exists(starterPack.insertedAt)",
		);
		await expect(
			subject([conflict()]).store.recordStarterInsertionFailure(input),
		).resolves.toBeUndefined();
		const error = new Error("offline");
		await expect(subject([error]).store.recordStarterInsertionFailure(input)).rejects.toBe(error);
	});
	it("commits a definition, twenty insert-only memberships, and the marker on the reader's own rows under the activity condition", async () => {
		const app = subject();
		expect(
			await app.store.saveStarterPack({
				userId,
				activityRevision: 3,
				pack,
				at: now,
				savedAt: Array(10).fill(now),
			}),
		).toBe("inserted");
		const transaction = z
			.object({ TransactItems: z.array(z.record(z.string(), z.unknown())) })
			.parse(app.commands[0]?.input);
		expect(transaction.TransactItems).toHaveLength(23);
		const tables = transaction.TransactItems.map(
			(item) => z.object({ TableName: z.string() }).parse(Object.values(item)[0]).TableName,
		);
		expect(new Set(tables)).toEqual(new Set(["onboarding", "notifications", "library"]));
		const puts = transaction.TransactItems.flatMap((item) =>
			item.Put === undefined
				? []
				: [
						z
							.object({
								Item: z.object({
									userId: z.string(),
									url: z.string(),
									status: z.string().optional(),
									provenance: z.unknown().optional(),
									suggestionAttribution: z.unknown().optional(),
								}),
								ConditionExpression: z.string(),
							})
							.parse(item.Put),
					],
		);
		expect(puts).toHaveLength(21);
		expect(puts.filter((put) => put.Item.status === "unread")).toHaveLength(20);
		expect(new Set(puts.filter((put) => put.Item.status).map((put) => put.Item.url)).size).toBe(10);
		expect(puts.every((put) => put.ConditionExpression === "attribute_not_exists(#url)")).toBe(
			true,
		);
		const checks = transaction.TransactItems.flatMap((item) =>
			item.ConditionCheck === undefined
				? []
				: [
						z
							.object({
								ConditionExpression: z.string(),
								ExpressionAttributeValues: z.record(z.string(), z.unknown()),
							})
							.parse(item.ConditionCheck),
					],
		);
		expect(checks).toHaveLength(1);
		expect(checks[0]?.ConditionExpression).toContain("engagement.activityRevision = :revision");
		expect(checks[0]?.ConditionExpression).toContain("engagement.assignment.arm = :arm");
		expect(checks[0]?.ConditionExpression).toContain(
			"engagement.assignment.campaignId = :campaign",
		);
		expect(checks[0]?.ExpressionAttributeValues).toEqual({
			":revision": 3,
			":arm": "treatment",
			":campaign": pack.campaignId,
		});
		const marker = z
			.object({
				ConditionExpression: z.string(),
				ExpressionAttributeValues: z.object({ ":pack": z.record(z.string(), z.unknown()) }).loose(),
			})
			.parse(transaction.TransactItems.find((item) => item.Update !== undefined)?.Update);
		expect(marker.ExpressionAttributeValues).toMatchObject({
			":pack": { insertedAt: now.toISOString(), insertionOutcome: "inserted" },
			":campaign": pack.campaignId,
			":selectedAt": pack.selectedAt,
			":pending": "pending",
		});
		for (const guard of [
			"attribute_not_exists(starterPack.insertedAt)",
			"starterPack.selectedAt = :selectedAt",
			"starterPack.emailStatus = :pending",
			"starterPack.campaignId = :campaign",
		])
			expect(marker.ConditionExpression).toContain(guard);
	});
	it("leaves the whole pack untouched on conflict and exposes operational failure", async () => {
		const input = { userId, activityRevision: 3, pack, at: now, savedAt: Array(10).fill(now) };
		expect(await subject([cancelled("ConditionalCheckFailed")]).store.saveStarterPack(input)).toBe(
			"conflict",
		);
		for (const error of [
			new Error("offline"),
			cancelled(),
			cancelled("ProvisionedThroughputExceeded"),
		])
			await expect(subject([error]).store.saveStarterPack(input)).rejects.toBe(error);
	});
	it("refreshes only uninserted selections and preserves the once marker against a racing retry", async () => {
		const input = { userId, selectedAt: pack.selectedAt, pack };
		const app = subject();
		expect(await app.store.replaceStarterSelection(input)).toBe("replaced");
		expect(app.commands[0]?.input.ConditionExpression).toContain(
			"attribute_not_exists(starterPack.insertedAt)",
		);
		expect(await subject([conflict()]).store.replaceStarterSelection(input)).toBe("conflict");
		const error = new Error("offline");
		await expect(subject([error]).store.replaceStarterSelection(input)).rejects.toBe(error);
	});
});

describe("persistent starter attempts", () => {
	it("claims the shared slot with a fully frozen message and reuses a sending attempt", async () => {
		const inserted = { ...pack, insertedAt: now.toISOString() };
		const app = subject([{ Item: { starterPack: inserted } }, {}]);
		const claimed = await app.store.claimStarterEmail({
			userId,
			message,
			at: now,
			minGapMs: 47.5 * 3_600_000,
			itemCount: 10,
		});
		expect(claimed).toEqual({
			...inserted,
			message,
			emailStatus: "sending",
			firstAttemptAt: now.toISOString(),
			itemCount: 10,
		});
		expect(app.commands[1]?.input.ConditionExpression).toContain(
			"lastReaderReadyEmailAt <= :cutoff",
		);
		expect(app.commands[1]?.input.UpdateExpression).toContain("lastReaderReadyEmailAt = :at");
		expect(app.commands[1]?.input.UpdateExpression).toContain(
			"lastReaderReadyEmailMessageId = :id",
		);
		expect(app.commands[1]?.input.UpdateExpression).toContain("lastReaderReadyEmailUrls = :urls");
		expect(app.commands[1]?.input.ExpressionAttributeValues).toMatchObject({
			":at": now.toISOString(),
			":id": message.idempotencyKey,
			":urls": pack.picks.map((pick) => pick.url),
			":cutoff": "2026-10-08T12:30:00.000Z",
		});
		const retry = subject([{ Item: { starterPack: claimed } }]);
		expect(
			await retry.store.claimStarterEmail({
				userId,
				message: { ...message, to: "changed" },
				at: now,
				minGapMs: 0,
				itemCount: 9,
			}),
		).toEqual(claimed);
		expect(retry.commands).toHaveLength(1);
	});
	it("loses a notification claim safely and propagates storage errors", async () => {
		const prior = { Item: { starterPack: { ...pack, insertedAt: now.toISOString() } } };
		const input = { userId, message, at: now, minGapMs: 1, itemCount: 10 };
		expect(await subject([prior, conflict()]).store.claimStarterEmail(input)).toBeUndefined();
		const error = new Error("offline");
		await expect(subject([prior, error]).store.claimStarterEmail(input)).rejects.toBe(error);
	});
	it("records acceptance, suppression and operational review without altering the frozen message", async () => {
		for (const status of ["sent", "suppressed", "review"]) {
			const app = subject([
				{
					Item: {
						starterPack: {
							...pack,
							message,
							emailStatus: status === "suppressed" ? "pending" : "sending",
						},
					},
				},
				{},
			]);
			if (status === "sent") await app.store.markStarterEmailSent({ userId, at: now });
			if (status === "suppressed") {
				await app.store.suppressStarterEmail({ userId, reason: "empty" });
			}
			if (status === "review") {
				await app.store.markStarterEmailReview({ userId, reason: "expired" });
			}
			const values = z
				.object({
					":pack": z.object({
						emailStatus: z.string(),
						message: z.unknown(),
						reason: z.string().optional(),
						sentAt: z.string().optional(),
					}),
				})
				.parse(app.commands[1]?.input.ExpressionAttributeValues)[":pack"];
			expect(values.emailStatus).toBe(status);
			expect(values.message).toEqual(message);
		}
		expect(await subject().store.findStarterPack(userId)).toBeUndefined();
		assert(pack.picks.length === 10);
	});
	it("keeps accepted and claimed attempts intact when a stale worker requests suppression or review", async () => {
		const accepted = subject([
			{ Item: { starterPack: { ...pack, message, emailStatus: "sent" } } },
		]);
		expect(await accepted.store.markStarterEmailReview({ userId, reason: "expired" })).toBe(false);
		expect(accepted.commands).toHaveLength(1);
		const claimed = subject([
			{ Item: { starterPack: { ...pack, message, emailStatus: "sending" } } },
		]);
		expect(await claimed.store.suppressStarterEmail({ userId, reason: "empty" })).toBe(false);
		expect(claimed.commands).toHaveLength(1);
		const prior = { Item: { starterPack: { ...pack, message, emailStatus: "sending" } } };
		expect(await subject([prior, conflict()]).store.markStarterEmailSent({ userId, at: now })).toBe(
			false,
		);
		const error = new Error("offline");
		await expect(
			subject([prior, error]).store.markStarterEmailSent({ userId, at: now }),
		).rejects.toBe(error);
	});
});
