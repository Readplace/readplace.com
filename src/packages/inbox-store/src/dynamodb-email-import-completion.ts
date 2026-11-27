import assert from "node:assert";
import {
	writeIfCondition,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/storage-client";
import { z } from "zod";
import { GmailMessageOriginSchema } from "@packages/domain/gmail";
import {
	type EmailImportCompletionStore,
	EmailOutputKeySchema,
	amendEmailSelection,
	type EmailOutputSelection,
	InboxAddressSchema,
	InboxEmailStatusSchema,
	MessageIdSchema,
	SupplementalEmailImportSchema,
	missingEmailDeliveryMode,
	uniqueGmailOrigins,
	EmailDeliveryModeSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";

const SelectionSchema = z.object({
	outputs: z.array(EmailOutputKeySchema),
	truncated: z.boolean(),
	selectedAt: z.string(),
	nextLinkIndex: z.number().optional(),
	matches: z.record(z.string(), z.array(EmailOutputKeySchema).nullable()).optional(),
});

const CompletionRow = z.object({
	userId: UserIdSchema,
	receivedAtMessageId: z.string(),
	outputSelection: dynamoField(SelectionSchema),
	supplementalSelection: dynamoField(SelectionSchema),
	supplementalImport: dynamoField(SupplementalEmailImportSchema),
	savedOutputs: dynamoField(z.set(EmailOutputKeySchema)),
	gmailOrigins: dynamoField(z.set(z.string())),
});

const CandidateRow = CompletionRow.extend({
	messageId: MessageIdSchema,
	senderEmail: z.string(),
	status: InboxEmailStatusSchema,
	gmailDestinationAddresses: dynamoField(z.array(InboxAddressSchema)),
	gmailDeliveryMode: dynamoField(EmailDeliveryModeSchema),
});

const CANDIDATE_FIELDS = [
	"userId",
	"messageId",
	"receivedAtMessageId",
	"senderEmail",
	"status",
	"gmailDestinationAddresses",
	"gmailDeliveryMode",
	"outputSelection",
	"savedOutputs",
	"gmailOrigins",
] as const;

const MAX_CANDIDATES_PER_READ = 100;

function parseOrigins(origins: ReadonlySet<string> | undefined) {
	return uniqueGmailOrigins([...(origins ?? [])].map((origin) => GmailMessageOriginSchema.parse(JSON.parse(origin))));
}

const ROW_EXISTS = "attribute_exists(receivedAtMessageId)";

export function initDynamoDbEmailImportCompletion(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): EmailImportCompletionStore {
	const table = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: CompletionRow });
	const candidates = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: CandidateRow });

	const findSelection = async (key: { userId: string; receivedAtMessageId: string }, field: "outputSelection" | "supplementalSelection"): Promise<EmailOutputSelection> => {
		const row = await table.get(key, { consistentRead: true });
		assert(row?.[field], "a selection that lost the conditional write is stored");
		return row[field];
	};

	return {
		claimSupplementalImport: async ({ userId, receivedAtMessageId, requested, work }) => {
			const Key = { userId, receivedAtMessageId };
			const row = await candidates.get(Key, { consistentRead: true });
			if (row?.status !== "received") return undefined;
			if (row.supplementalImport !== undefined) {
				return row.supplementalImport.rawEmailS3Key === work.rawEmailS3Key ? row.supplementalImport : undefined;
			}
			const deliveryMode = missingEmailDeliveryMode({ requested, accepted: row.gmailDeliveryMode, selection: row.outputSelection });
			if (deliveryMode === undefined) return undefined;

			const supplementalImport = { ...work, deliveryMode };
			const outcome = await writeIfCondition(() => table.update({
				Key,
				ConditionExpression: `${ROW_EXISTS} AND attribute_not_exists(supplementalImport)`,
				UpdateExpression: "SET supplementalImport = :work",
				ExpressionAttributeValues: { ":work": supplementalImport },
			}));
			if (outcome.kind === "written") return supplementalImport;
			const accepted = (await table.get(Key, { consistentRead: true }))?.supplementalImport;
			return accepted?.rawEmailS3Key === work.rawEmailS3Key ? accepted : undefined;
		},
		addGmailOrigins: async ({ userId, receivedAtMessageId, origins }) => {
			if (origins.length === 0) return;
			await table.update({
				Key: { userId, receivedAtMessageId },
				ConditionExpression: ROW_EXISTS,
				UpdateExpression: "ADD gmailOrigins :origins",
				ExpressionAttributeValues: { ":origins": new Set(origins.map((origin) => JSON.stringify(origin))) },
			});
		},
		selectOutputs: async ({ userId, receivedAtMessageId, selection, supplemental }) => {
			const field = supplemental ? "supplementalSelection" : "outputSelection";
			const outcome = await writeIfCondition(() => table.update({
				Key: { userId, receivedAtMessageId },
				ConditionExpression: `${ROW_EXISTS} AND attribute_not_exists(${field})`,
				UpdateExpression: `SET ${field} = :selection`,
				ExpressionAttributeValues: { ":selection": selection },
			}));
			if (outcome.kind === "condition-failed") return findSelection({ userId, receivedAtMessageId }, field);
			return selection;
		},
		amendSelection: async ({ userId, receivedAtMessageId, change }) => {
			const Key = { userId, receivedAtMessageId };
			for (;;) {
				const current = await findSelection(Key, "outputSelection");
				const next = amendEmailSelection(current, change);
				if (next === current) return current;
				const written = await writeIfCondition(() => table.update({
					Key,
					ConditionExpression: "outputSelection = :previous",
					UpdateExpression: "SET outputSelection = :next",
					ExpressionAttributeValues: { ":previous": current, ":next": next },
				}));
				if (written.kind === "written") return next;
			}
		},
		acknowledgeOutput: async ({ userId, receivedAtMessageId, output }) => {
			await writeIfCondition(() => table.update({
				Key: { userId, receivedAtMessageId },
				ConditionExpression: ROW_EXISTS,
				UpdateExpression: "ADD savedOutputs :output",
				ExpressionAttributeValues: { ":output": new Set([output]) },
			}));
		},
		findCompletion: async ({ userId, receivedAtMessageId }) => {
			const row = await table.get({ userId, receivedAtMessageId }, { consistentRead: true });
			if (row === undefined) return undefined;
			return {
				selection: row.outputSelection,
				...(row.supplementalImport === undefined ? {} : { supplementalImport: row.supplementalImport }),
				...(row.supplementalSelection === undefined ? {} : { supplementalSelection: row.supplementalSelection }),
				savedOutputs: row.savedOutputs ?? new Set(),
				origins: parseOrigins(row.gmailOrigins),
			};
		},
		listCompletionsBefore: async ({ userId, before, limit }) => {
			const { items, lastEvaluatedKey } = await candidates.query({
				KeyConditionExpression: "userId = :uid AND receivedAtMessageId < :before",
				ExpressionAttributeValues: { ":uid": userId, ":before": before },
				ProjectionExpression: CANDIDATE_FIELDS.map((field) => `#${field}`).join(", "),
				ExpressionAttributeNames: Object.fromEntries(CANDIDATE_FIELDS.map((field) => [`#${field}`, field])),
				ScanIndexForward: false,
				Limit: Math.min(limit, MAX_CANDIDATES_PER_READ),
			});
			return {
				emails: items.map((row) => ({
					receivedAtMessageId: row.receivedAtMessageId,
					messageId: row.messageId,
					senderEmail: row.senderEmail,
					status: row.status,
					gmailDestinationAddresses: row.gmailDestinationAddresses,
					gmailDeliveryMode: row.gmailDeliveryMode,
					selection: row.outputSelection,
					savedOutputs: row.savedOutputs ?? new Set(),
					origins: parseOrigins(row.gmailOrigins),
				})),
				exhausted: lastEvaluatedKey === undefined,
			};
		},
	};
}
