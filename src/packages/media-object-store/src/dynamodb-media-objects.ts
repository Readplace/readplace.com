import {
	type DynamoDBDocumentClient,
	TransactWriteCommand,
	defineDynamoTable,
	forEachQueryPage,
	transactIfConditions,
} from "@packages/storage-client";
import type { UploadId } from "@packages/media-contracts";
import { z } from "zod";
import type { MediaObjectRows, ObjectMeta } from "./media-objects.types";
import { type ObjectSha256, ObjectSha256Schema } from "./object-sha256";

const ObjectMetaRowSchema = z.object({
	size: z.number().int().nonnegative(),
	mediaType: z.string(),
	generation: z.number().int().positive(),
	holders: z.number().int().nonnegative(),
	state: z.enum(["live", "deleting"]),
});

const RefRowSchema = z.object({ pk: z.string(), sk: z.string() });

const HoldsRowSchema = z.object({ sha256: ObjectSha256Schema });

const META_NAMES = { "#state": "state", "#generation": "generation", "#holders": "holders" };

function metaKey(sha256: ObjectSha256) {
	return { pk: `object#${sha256}`, sk: "meta" };
}

function refKey(params: { sha256: ObjectSha256; uploadId: UploadId }) {
	return { pk: `object#${params.sha256}`, sk: `ref#${params.uploadId}` };
}

function holdKey(params: { sha256: ObjectSha256; uploadId: UploadId }) {
	return { pk: `upload#${params.uploadId}`, sk: `holds#${params.sha256}` };
}

function metaAsSeen(seen: ObjectMeta | undefined) {
	if (seen === undefined) return { ConditionExpression: "attribute_not_exists(pk)" };
	return {
		ConditionExpression: "#state = :seenState AND #generation = :seenGeneration AND #holders = :seenHolders",
		ExpressionAttributeNames: META_NAMES,
		ExpressionAttributeValues: {
			":seenState": seen.state,
			":seenGeneration": seen.generation,
			":seenHolders": seen.holders,
		},
	};
}

export function initDynamoDbMediaObjects(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	tableName: string;
}): MediaObjectRows {
	const { client, tableName } = deps;
	const metaTable = defineDynamoTable({ client, tableName, schema: ObjectMetaRowSchema });
	const refTable = defineDynamoTable({ client, tableName, schema: RefRowSchema });
	const holdsTable = defineDynamoTable({ client, tableName, schema: HoldsRowSchema });

	const transact = async (
		items: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]>,
	): Promise<"done" | "conflict"> => {
		const outcome = await transactIfConditions(() => client.send(new TransactWriteCommand({ TransactItems: items })));
		return outcome.kind === "written" ? "done" : "conflict";
	};

	return {
		async readHolding(params) {
			const [meta, ref] = await Promise.all([
				metaTable.get(metaKey(params.sha256), { consistentRead: true }),
				refTable.get(refKey(params), { consistentRead: true }),
			]);
			return { meta, held: ref !== undefined };
		},

		async writeHolding({ sha256, uploadId, meta, seen }) {
			const outcome = await transact([
				{ Put: { TableName: tableName, Item: { ...metaKey(sha256), ...meta }, ...metaAsSeen(seen) } },
				{
					Put: {
						TableName: tableName,
						Item: refKey({ sha256, uploadId }),
						ConditionExpression: "attribute_not_exists(pk)",
					},
				},
				{ Put: { TableName: tableName, Item: { ...holdKey({ sha256, uploadId }), sha256 } } },
			]);
			return outcome === "done" ? "written" : "conflict";
		},

		async releaseHolding({ sha256, uploadId, meta, seen }) {
			const outcome = await transact([
				{ Put: { TableName: tableName, Item: { ...metaKey(sha256), ...meta }, ...metaAsSeen(seen) } },
				{
					Delete: {
						TableName: tableName,
						Key: refKey({ sha256, uploadId }),
						ConditionExpression: "attribute_exists(pk)",
					},
				},
			]);
			return outcome === "done" ? "released" : "conflict";
		},

		async listHeldObjects({ uploadId }) {
			const held: ObjectSha256[] = [];
			await forEachQueryPage(
				holdsTable,
				{
					KeyConditionExpression: "pk = :pk AND begins_with(sk, :holds)",
					ExpressionAttributeValues: { ":pk": `upload#${uploadId}`, ":holds": "holds#" },
					ConsistentRead: true,
				},
				async (items) => {
					held.push(...items.map((item) => item.sha256));
				},
			);
			return held;
		},

		async readMeta({ sha256 }) {
			return metaTable.get(metaKey(sha256), { consistentRead: true });
		},

		async deleteHold(params) {
			await holdsTable.delete({ Key: holdKey(params) });
		},
	};
}
