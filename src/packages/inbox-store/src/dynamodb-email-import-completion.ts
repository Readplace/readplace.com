import assert from "node:assert";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { GmailDeliveryModeSchema, GmailMessageOriginSchema } from "@packages/domain/gmail";
import {
	type EmailImportCompletionStore,
	EmailOutputKeySchema,
	type EmailOutputSelection,
	InboxAddressSchema,
	InboxEmailStatusSchema,
	MessageIdSchema,
	uniqueGmailOrigins,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";

const SelectionSchema = z.object({
	outputs: z.array(EmailOutputKeySchema),
	truncated: z.boolean(),
	selectedAt: z.string(),
});

const CompletionRow = z.object({
	userId: UserIdSchema,
	receivedAtMessageId: z.string(),
	outputSelection: dynamoField(SelectionSchema),
	savedOutputs: dynamoField(z.set(EmailOutputKeySchema)),
	gmailOrigins: dynamoField(z.set(z.string())),
});

const CandidateRow = CompletionRow.extend({
	messageId: MessageIdSchema,
	senderEmail: z.string(),
	status: InboxEmailStatusSchema,
	gmailDestinationAddresses: dynamoField(z.array(InboxAddressSchema)),
	gmailDeliveryMode: dynamoField(GmailDeliveryModeSchema),
});

const CANDIDATE_FIELDS = [
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

	const findSelection = async (key: { userId: string; receivedAtMessageId: string }): Promise<EmailOutputSelection> => {
		const row = await table.get(key, { consistentRead: true });
		assert(row?.outputSelection, "a selection that lost the conditional write is stored");
		return row.outputSelection;
	};

	return {
		addGmailOrigins: async ({ userId, receivedAtMessageId, origins }) => {
			if (origins.length === 0) return;
			await table.update({
				Key: { userId, receivedAtMessageId },
				ConditionExpression: ROW_EXISTS,
				UpdateExpression: "ADD gmailOrigins :origins",
				ExpressionAttributeValues: { ":origins": new Set(origins.map((origin) => JSON.stringify(origin))) },
			});
		},
		selectOutputs: async ({ userId, receivedAtMessageId, selection }) => {
			try {
				await table.update({
					Key: { userId, receivedAtMessageId },
					ConditionExpression: `${ROW_EXISTS} AND attribute_not_exists(outputSelection)`,
					UpdateExpression: "SET outputSelection = :selection",
					ExpressionAttributeValues: { ":selection": selection },
				});
				return selection;
			} catch (error) {
				if (error instanceof ConditionalCheckFailedException) return findSelection({ userId, receivedAtMessageId });
				throw error;
			}
		},
		acknowledgeOutput: async ({ userId, receivedAtMessageId, output }) => {
			try {
				await table.update({
					Key: { userId, receivedAtMessageId },
					ConditionExpression: ROW_EXISTS,
					UpdateExpression: "ADD savedOutputs :output",
					ExpressionAttributeValues: { ":output": new Set([output]) },
				});
			} catch (error) {
				if (!(error instanceof ConditionalCheckFailedException)) throw error;
			}
		},
		findCompletion: async ({ userId, receivedAtMessageId }) => {
			const row = await table.get({ userId, receivedAtMessageId }, { consistentRead: true });
			if (row === undefined) return undefined;
			return {
				selection: row.outputSelection,
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
