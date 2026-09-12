import { defineDynamoTable, forEachQueryPage, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { RefreshOutcome, type RefreshRefusal } from "./outcomes";
import type { RefreshAttempt } from "./evidence";

export function initDynamoRefreshOutcomes(deps: { client: DynamoDBDocumentClient; tableName: string }) {
	const table = defineDynamoTable({ ...deps, schema: RefreshOutcome });
	function key(attempt: RefreshAttempt) {
		return { day: new Date(attempt.occurredAt).toISOString().slice(0, 10), order: `${attempt.occurredAt}#${attempt.refusalId}` };
	}
	return {
		async refuse(refusal: RefreshRefusal) {
			await table.update({ Key: key(refusal), UpdateExpression: "SET refusal = if_not_exists(refusal, :refusal), expiresAt = :ttl", ExpressionAttributeValues: { ":refusal": refusal, ":ttl": Math.floor(refusal.occurredAt / 1000) + 31 * 86_400 } });
		},
		async recover(attempt: RefreshAttempt, recoveredAt: number) {
			await table.update({ Key: key(attempt), UpdateExpression: "SET recoveredAt = if_not_exists(recoveredAt, :recovered), expiresAt = :ttl", ExpressionAttributeValues: { ":recovered": recoveredAt, ":ttl": Math.floor(attempt.occurredAt / 1000) + 31 * 86_400 } });
		},
		async readDay(input: { day: string; from: number; until: number }): Promise<RefreshOutcome[]> {
			const rows: RefreshOutcome[] = [];
			await forEachQueryPage(table, { KeyConditionExpression: "#day = :day AND #order BETWEEN :from AND :until", ExpressionAttributeNames: { "#day": "day", "#order": "order" }, ExpressionAttributeValues: { ":day": input.day, ":from": `${input.from}#`, ":until": `${input.until}#~` }, ConsistentRead: true }, async page => { rows.push(...page); });
			return rows;
		},
	};
}
