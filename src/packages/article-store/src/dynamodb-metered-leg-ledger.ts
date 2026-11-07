import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	writeIfCondition,
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

const MeteredLegRow = z.object({ url: z.string(), fullCrawlRequestedAt: z.string().optional() });

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
		const written = await writeIfCondition(() =>
			table.update({
				Key: { url: ArticleResourceUniqueId.parse(url).value },
				UpdateExpression: "SET #claim = :claim, fullCrawlRequestedAt = if_not_exists(fullCrawlRequestedAt, :now)",
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
			}),
		);
		if (written.kind === "condition-failed") {
			return classifyRefusedClaim(written.oldItem, { leg, hash: inputHash });
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
		await writeIfCondition(() =>
			table.update({
				Key: { url: ArticleResourceUniqueId.parse(url).value },
				UpdateExpression: "REMOVE #claim",
				ConditionExpression: "#claim.claimId = :claimId",
				ExpressionAttributeNames: { "#claim": `claim_${permit.leg}` },
				ExpressionAttributeValues: { ":claimId": permit.claimId },
			}),
		);
	};

	return { claimMeteredLeg, settleMeteredLeg, releaseMeteredLeg };
}
