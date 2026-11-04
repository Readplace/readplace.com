import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/storage-client";
import {
	type ClaimMeteredLeg,
	type MeteredLeg,
	PaidLegPermitSchema,
	type ReleaseMeteredLeg,
	type SettleMeteredLeg,
} from "@packages/provider-contracts/metered-leg-ledger";
import { z } from "zod";
import { classifyRefusedClaim } from "./classify-refused-claim";

const MeteredLegRow = z.object({ url: z.string() });

function legAttributeNames(leg: MeteredLeg) {
	return { "#claim": `claim_${leg}`, "#ledger": `ledger_${leg}` };
}

export function initDynamoDbMeteredLegLedger(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): {
	claimMeteredLeg: ClaimMeteredLeg;
	settleMeteredLeg: SettleMeteredLeg;
	releaseMeteredLeg: ReleaseMeteredLeg;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: MeteredLegRow,
	});

	const claimMeteredLeg: ClaimMeteredLeg = async ({ url, leg, inputHash, claimId, expiresAt }) => {
		try {
			await table.update({
				Key: { url: ArticleResourceUniqueId.parse(url).value },
				UpdateExpression: "SET #claim = :claim",
				ConditionExpression:
					"attribute_not_exists(meteredLegsDeferredSince) AND (attribute_not_exists(#claim) OR #claim.expiresAt < :now OR #claim.claimId = :claimId) AND (attribute_not_exists(#ledger) OR #ledger.inputHash <> :hash)",
				ExpressionAttributeNames: legAttributeNames(leg),
				ExpressionAttributeValues: {
					":claim": { claimId, expiresAt },
					":now": deps.now().toISOString(),
					":claimId": claimId,
					":hash": inputHash,
				},
				ReturnValuesOnConditionCheckFailure: "ALL_OLD",
			});
		} catch (error) {
			if (!(error instanceof ConditionalCheckFailedException)) throw error;
			return classifyRefusedClaim(error.Item, { leg, hash: inputHash });
		}
		return { kind: "granted", permit: PaidLegPermitSchema.parse({ leg, claimId, inputHash }) };
	};

	const settleMeteredLeg: SettleMeteredLeg = async ({ url, permit, outcome, settledAt }) => {
		await table.update({
			Key: { url: ArticleResourceUniqueId.parse(url).value },
			UpdateExpression: "SET #ledger = :entry REMOVE #claim",
			ConditionExpression: "#claim.claimId = :claimId",
			ExpressionAttributeNames: legAttributeNames(permit.leg),
			ExpressionAttributeValues: {
				":entry": { inputHash: permit.inputHash, outcome, settledAt },
				":claimId": permit.claimId,
			},
		});
	};

	const releaseMeteredLeg: ReleaseMeteredLeg = async ({ url, permit }) => {
		try {
			await table.update({
				Key: { url: ArticleResourceUniqueId.parse(url).value },
				UpdateExpression: "REMOVE #claim",
				ConditionExpression: "#claim.claimId = :claimId",
				ExpressionAttributeNames: { "#claim": `claim_${permit.leg}` },
				ExpressionAttributeValues: { ":claimId": permit.claimId },
			});
		} catch (error) {
			if (!(error instanceof ConditionalCheckFailedException)) throw error;
		}
	};

	return { claimMeteredLeg, settleMeteredLeg, releaseMeteredLeg };
}
