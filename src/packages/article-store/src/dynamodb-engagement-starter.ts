import assert from "node:assert";
import { randomUUID } from "node:crypto";
import type { UserId } from "@packages/domain/user";
import { z } from "zod";
import {
	ConditionalCheckFailedException,
	TransactionCanceledException,
	TransactWriteCommand,
	batchGetFromTable,
	defineDynamoTable,
	forEachQueryPage,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import {
	EngagementStateSchema,
	StarterPackSchema,
	type EngagementStarterState,
	type EngagementState,
	type SaveStarterPack,
	type StarterPack,
} from "@packages/provider-contracts/engagement-starter";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import { partitionFor, readlistDefinitionKey } from "./user-readlist-partition";

const DAY_MS = 86_400_000;

export function initDynamoDbEngagementActivity(deps: {
	client: DynamoDBDocumentClient;
	onboardingTableName: string;
}): Pick<
	EngagementStarterState,
	"findEngagement" | "observeEngagement" | "recordEngagementActivity"
> {
	const onboarding = defineDynamoTable({
		client: deps.client,
		tableName: deps.onboardingTableName,
		schema: z.object({ engagement: EngagementStateSchema.optional() }),
	});
	const findEngagement: EngagementStarterState["findEngagement"] = async (userId) =>
		(await onboarding.get({ userId }, { consistentRead: true }))?.engagement ?? {
			activityRevision: 0,
		};
	const updateEngagement = async (
		userId: UserId,
		transform: (state: EngagementState) => EngagementState,
	) => {
		for (;;) {
			const state = await findEngagement(userId);
			const next = transform(state);
			try {
				await onboarding.update({
					Key: { userId },
					UpdateExpression: "SET engagement = :state",
					ConditionExpression:
						"attribute_not_exists(engagement) OR engagement.activityRevision = :revision",
					ExpressionAttributeValues: { ":state": next, ":revision": state.activityRevision },
				});
				return next;
			} catch (error) {
				if (!(error instanceof ConditionalCheckFailedException)) throw error;
			}
		}
	};
	const observeEngagement: EngagementStarterState["observeEngagement"] = ({ userId, startedAt }) =>
		updateEngagement(userId, (state) => ({
			...state,
			observationStartedAt: state.observationStartedAt ?? startedAt,
			activityRevision: state.activityRevision + 1,
		}));
	const recordEngagementActivity: EngagementStarterState["recordEngagementActivity"] = async (
		input,
	) => {
		await updateEngagement(input.userId, (state) => {
			const at = input.at.toISOString();
			const primary =
				input.kind === "personal-save" ||
				input.kind === "mcp-content" ||
				input.kind === "mcp-summary" ||
				(input.kind === "read-status" && input.markedRead === true);
			const daysSinceAssignment =
				state.assignment === undefined
					? -1
					: (input.at.getTime() - Date.parse(state.assignment.assignedAt)) / DAY_MS;
			return {
				...state,
				activityRevision: state.activityRevision + 1,
				lastActivityAt:
					state.lastActivityAt === undefined || at > state.lastActivityAt
						? at
						: state.lastActivityAt,
				...(primary &&
				daysSinceAssignment >= 0 &&
				daysSinceAssignment < 7 &&
				state.activatedAt === undefined
					? { activatedAt: at }
					: {}),
				...(daysSinceAssignment >= 7 &&
				daysSinceAssignment < 14 &&
				state.engagedDays8To14At === undefined
					? { engagedDays8To14At: at }
					: {}),
			};
		});
	};
	return { findEngagement, observeEngagement, recordEngagementActivity };
}

export function initDynamoDbEngagementStarter(deps: {
	client: DynamoDBDocumentClient;
	onboardingTableName: string;
	notificationsTableName: string;
	userArticlesTableName: string;
}): EngagementStarterState & { saveStarterPack: SaveStarterPack } {
	const { findEngagement, observeEngagement, recordEngagementActivity } =
		initDynamoDbEngagementActivity(deps);
	const notices = defineDynamoTable({
		client: deps.client,
		tableName: deps.notificationsTableName,
		schema: z.object({ starterPack: StarterPackSchema.optional() }),
	});
	const findStarterPack: EngagementStarterState["findStarterPack"] = async (userId) =>
		(await notices.get({ userId }, { consistentRead: true }))?.starterPack;
	const withdrawStarterAssignment: EngagementStarterState["withdrawStarterAssignment"] = async (
		userId,
	) => {
		for (;;) {
			const engagement = await findEngagement(userId);
			if (engagement.assignment === undefined) return;
			const pack = await findStarterPack(userId);
			const anonymousId = randomUUID();
			const {
				observationStartedAt: _observationStartedAt,
				lastActivityAt: _lastActivityAt,
				activityRevision: _activityRevision,
				...outcome
			} = engagement;
			try {
				await deps.client.send(
					new TransactWriteCommand({
						TransactItems: [
							{
								Update: {
									TableName: deps.onboardingTableName,
									Key: { userId },
									UpdateExpression: "REMOVE engagement, starterCampaignId",
									ConditionExpression: "engagement.activityRevision = :revision",
									ExpressionAttributeValues: { ":revision": engagement.activityRevision },
								},
							},
							{
								Update: {
									TableName: deps.onboardingTableName,
									Key: { userId: anonymousId },
									UpdateExpression: "SET engagement = :engagement, starterCampaignId = :campaign",
									ConditionExpression: "attribute_not_exists(userId)",
									ExpressionAttributeValues: {
										":engagement": { ...outcome, activityRevision: 0 },
										":campaign": engagement.assignment.campaignId,
									},
								},
							},
							...(pack === undefined ? [] : [anonymousStarterOutcome({ anonymousId, pack })]),
						],
					}),
				);
				return;
			} catch (error) {
				if (
					!(
						error instanceof TransactionCanceledException &&
						error.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed")
					)
				) {
					throw error;
				}
			}
		}
	};
	const anonymousStarterOutcome = (input: { anonymousId: string; pack: StarterPack }) => {
		const { message: _message, ...outcome } = input.pack;
		return {
			Update: {
				TableName: deps.notificationsTableName,
				Key: { userId: input.anonymousId },
				UpdateExpression: "SET starterPack = :pack",
				ConditionExpression: "attribute_not_exists(userId)",
				ExpressionAttributeValues: { ":pack": { ...outcome, picks: [] } },
			},
		};
	};
	const assignStarter: EngagementStarterState["assignStarter"] = async ({
		userId,
		revision,
		assignment,
		pack,
	}) => {
		try {
			await deps.client.send(
				new TransactWriteCommand({
					TransactItems: [
						{
							Update: {
								TableName: deps.onboardingTableName,
								Key: { userId },
								UpdateExpression:
									"SET engagement.assignment = :assignment, engagement.activityRevision = :next, starterCampaignId = :campaign",
								ConditionExpression:
									"engagement.activityRevision = :revision AND attribute_not_exists(engagement.assignment)",
								ExpressionAttributeValues: {
									":assignment": assignment,
									":revision": revision,
									":next": revision + 1,
									":campaign": assignment.campaignId,
								},
							},
						},
						...(assignment.arm === "comparison"
							? []
							: [
									{
										Update: {
											TableName: deps.notificationsTableName,
											Key: { userId },
											UpdateExpression: "SET starterPack = :pack",
											ConditionExpression: "attribute_not_exists(starterPack)",
											ExpressionAttributeValues: { ":pack": pack },
										},
									},
								]),
					],
				}),
			);
			return "assigned";
		} catch (error) {
			if (
				error instanceof TransactionCanceledException &&
				error.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed")
			) {
				return "conflict";
			}
			throw error;
		}
	};
	const saveStarterPack: SaveStarterPack = async ({
		userId,
		activityRevision,
		pack,
		savedAt,
		at,
	}) => {
		assert(
			pack.picks.length === 10 && savedAt.length === 10,
			"a starter has ten selected articles and ten saved positions",
		);
		assert(
			new Set(pack.picks.map((pick) => ArticleResourceUniqueId.parse(pick.url).value)).size === 10,
			"a starter has ten canonical identities",
		);
		const inserted = {
			...pack,
			insertedAt: at.toISOString(),
			insertionOutcome: "inserted",
			lastInsertionAttemptAt: at.toISOString(),
		};
		try {
			await deps.client.send(
				new TransactWriteCommand({
					TransactItems: [
						{
							ConditionCheck: {
								TableName: deps.onboardingTableName,
								Key: { userId },
								ConditionExpression:
									"engagement.activityRevision = :revision AND engagement.assignment.arm = :arm AND engagement.assignment.campaignId = :campaign",
								ExpressionAttributeValues: {
									":revision": activityRevision,
									":arm": "treatment",
									":campaign": pack.campaignId,
								},
							},
						},
						{
							Update: {
								TableName: deps.notificationsTableName,
								Key: { userId },
								UpdateExpression: "SET starterPack = :pack",
								ConditionExpression:
									"starterPack.campaignId = :campaign AND starterPack.selectedAt = :selectedAt AND attribute_not_exists(starterPack.insertedAt) AND starterPack.emailStatus = :pending",
								ExpressionAttributeValues: {
									":pack": inserted,
									":campaign": pack.campaignId,
									":selectedAt": pack.selectedAt,
									":pending": "pending",
								},
							},
						},
						{
							Put: {
								TableName: deps.userArticlesTableName,
								Item: {
									userId,
									url: readlistDefinitionKey(pack.readlist),
									queueSlug: pack.readlist,
									queueLabel: pack.readlistLabel,
									createdAt: at.toISOString(),
									starterCampaignId: pack.campaignId,
								},
								ConditionExpression: "attribute_not_exists(#url)",
								ExpressionAttributeNames: { "#url": "url" },
							},
						},
						...pack.picks.flatMap((pick, index) =>
							[DEFAULT_READLIST_SLUG, pack.readlist].map((readlist) => ({
								Put: {
									TableName: deps.userArticlesTableName,
									Item: {
										userId: partitionFor({ userId, readlist }),
										url: ArticleResourceUniqueId.parse(pick.url).value,
										status: "unread",
										savedAt: savedAt[index]?.toISOString(),
										provenance: { kind: "hn-suggestion", ...pick, campaignId: pack.campaignId },
										suggestionAttribution: {
											campaignId: pack.campaignId,
											hnItemId: pick.hnItemId,
											rank: pick.rank,
											snapshotAt: pick.snapshotAt,
										},
									},
									ConditionExpression: "attribute_not_exists(#url)",
									ExpressionAttributeNames: { "#url": "url" },
								},
							})),
						),
					],
				}),
			);
			return "inserted";
		} catch (error) {
			if (
				error instanceof TransactionCanceledException &&
				error.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed")
			) {
				return "conflict";
			}
			throw error;
		}
	};
	const updateEmailStatus = async (input: {
		userId: UserId;
		status: "suppressed" | "review" | "sent";
		reason?: string;
		at?: Date;
	}) => {
		const pack = await findStarterPack(input.userId);
		assert(pack, "starter status updates require a frozen selection");
		const prior = input.status === "suppressed" ? "pending" : "sending";
		if (pack.emailStatus !== prior) return false;
		const next = {
			...pack,
			emailStatus: input.status,
			...(input.reason === undefined ? {} : { reason: input.reason }),
			...(input.at === undefined ? {} : { sentAt: input.at.toISOString() }),
		};
		try {
			await notices.update({
				Key: { userId: input.userId },
				UpdateExpression: "SET starterPack = :pack",
				ConditionExpression: "starterPack.emailStatus = :prior",
				ExpressionAttributeValues: { ":pack": next, ":prior": prior },
			});
			return true;
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return false;
			throw error;
		}
	};
	const claimStarterEmail: EngagementStarterState["claimStarterEmail"] = async ({
		userId,
		message,
		at,
		minGapMs,
		itemCount,
	}) => {
		const pack = await findStarterPack(userId);
		assert(pack?.insertedAt, "email is only claimed after insertion");
		if (pack.emailStatus === "sending") return pack;
		const claimed = {
			...pack,
			emailStatus: "sending" as const,
			message,
			firstAttemptAt: at.toISOString(),
			itemCount,
		};
		try {
			await notices.update({
				Key: { userId },
				UpdateExpression:
					"SET starterPack = :pack, lastReaderReadyEmailAt = :at, lastReaderReadyEmailMessageId = :id, lastReaderReadyEmailUrls = :urls",
				ConditionExpression:
					"starterPack.emailStatus = :pending AND (attribute_not_exists(lastReaderReadyEmailAt) OR lastReaderReadyEmailAt <= :cutoff)",
				ExpressionAttributeValues: {
					":pack": claimed,
					":at": at.toISOString(),
					":id": message.idempotencyKey,
					":urls": pack.picks.map((pick) => pick.url),
					":pending": "pending",
					":cutoff": new Date(at.getTime() - minGapMs).toISOString(),
				},
			});
			return claimed;
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return undefined;
			throw error;
		}
	};
	return {
		listStarterObservations: async (campaignId) => {
			const accounts = defineDynamoTable({
				client: deps.client,
				tableName: deps.onboardingTableName,
				schema: z.object({ userId: UserIdSchema, engagement: EngagementStateSchema }),
			});
			const assigned: { userId: UserId; engagement: EngagementState }[] = [];
			await forEachQueryPage(
				accounts,
				{
					IndexName: "starterCampaignId-index",
					KeyConditionExpression: "starterCampaignId = :campaign",
					ExpressionAttributeValues: { ":campaign": campaignId },
				},
				async (items) => {
					assigned.push(...items);
				},
			);
			const packs = new Map(
				(
					await batchGetFromTable({
						client: deps.client,
						tableName: deps.notificationsTableName,
						schema: z.object({ userId: UserIdSchema, starterPack: StarterPackSchema.optional() }),
						keys: assigned.map(({ userId }) => ({ userId })),
					})
				).map((row) => [row.userId, row.starterPack]),
			);
			return assigned.map((account) => ({
				...account,
				starterPack: packs.get(account.userId),
			}));
		},
		findEngagement,
		withdrawStarterAssignment,
		observeEngagement,
		recordEngagementActivity,
		assignStarter,
		findStarterPack,
		saveStarterPack,
		claimStarterEmail,
		recordStarterInsertionFailure: async ({ userId, selectedAt, at, outcome }) => {
			try {
				await notices.update({
					Key: { userId },
					UpdateExpression:
						"SET starterPack.insertionOutcome = :outcome, starterPack.lastInsertionAttemptAt = :at",
					ConditionExpression:
						"starterPack.selectedAt = :selectedAt AND attribute_not_exists(starterPack.insertedAt)",
					ExpressionAttributeValues: {
						":selectedAt": selectedAt,
						":outcome": outcome,
						":at": at.toISOString(),
					},
				});
			} catch (error) {
				if (error instanceof ConditionalCheckFailedException) return;
				throw error;
			}
		},
		replaceStarterSelection: async ({ userId, selectedAt, pack }) => {
			try {
				await notices.update({
					Key: { userId },
					UpdateExpression: "SET starterPack = :pack",
					ConditionExpression:
						"starterPack.selectedAt = :selectedAt AND attribute_not_exists(starterPack.insertedAt) AND starterPack.emailStatus = :pending",
					ExpressionAttributeValues: {
						":pack": pack,
						":selectedAt": selectedAt,
						":pending": "pending",
					},
				});
				return "replaced";
			} catch (error) {
				if (error instanceof ConditionalCheckFailedException) return "conflict";
				throw error;
			}
		},
		suppressStarterEmail: ({ userId, reason }) =>
			updateEmailStatus({ userId, reason, status: "suppressed" }),
		markStarterEmailReview: ({ userId, reason }) =>
			updateEmailStatus({ userId, reason, status: "review" }),
		markStarterEmailSent: ({ userId, at }) => updateEmailStatus({ userId, at, status: "sent" }),
	};
}
