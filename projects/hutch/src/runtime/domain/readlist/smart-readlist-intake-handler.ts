import { UserIdSchema } from "@packages/domain/user";
import { MatchSmartReadlistsCommand } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { ListReadlistDefinitions } from "@packages/provider-contracts/article-store";
import type { DynamoDBBatchResponse, DynamoDBRecord, DynamoDBStreamEvent, Handler } from "aws-lambda";
import { z } from "zod";

const DEFINITION_ROW_PREFIX = "readplace:";

const InsertedRow = z.object({
	eventName: z.literal("INSERT"),
	dynamodb: z.object({
		SequenceNumber: z.string(),
		NewImage: z.looseObject({
			userId: z.object({ S: z.string() }),
			url: z.object({ S: z.string() }),
			savedAt: z.object({ S: z.iso.datetime() }),
			highlightOf: z.undefined().optional(),
			restoredAt: z.undefined().optional(),
			provenance: z.object({ M: z.looseObject({ kind: z.object({ S: z.string() }) }) }).optional(),
		}),
	}),
});

function newSaveInAll(record: DynamoDBRecord) {
	const parsed = InsertedRow.safeParse(record);
	if (!parsed.success) return undefined;
	const image = parsed.data.dynamodb.NewImage;
	if (image.userId.S.includes("#")) return undefined;
	if (image.url.S.startsWith(DEFINITION_ROW_PREFIX)) return undefined;
	if (image.provenance?.M.kind.S === "email") return undefined;
	return {
		sequenceNumber: parsed.data.dynamodb.SequenceNumber,
		userId: UserIdSchema.parse(image.userId.S),
		storedKey: image.url.S,
		savedAt: new Date(image.savedAt.S),
	};
}

export function initSmartReadlistIntakeHandler(deps: {
	listReadlistDefinitions: ListReadlistDefinitions;
	publishEvent: PublishEvent;
	logger: Logger;
}): Handler<DynamoDBStreamEvent, DynamoDBBatchResponse> {
	const { listReadlistDefinitions, publishEvent, logger } = deps;

	const intake = async (save: NonNullable<ReturnType<typeof newSaveInAll>>) => {
		const definitions = await listReadlistDefinitions(save.userId);
		const matchesAny = definitions.some(
			(definition) => definition.filing?.mode === "smart" && definition.filing.effectiveAt <= save.savedAt,
		);
		if (!matchesAny) return;
		await publishEvent(MatchSmartReadlistsCommand, {
			userId: save.userId,
			storedKey: save.storedKey,
			savedAt: save.savedAt.toISOString(),
		});
	};

	return async (event) => {
		const batchItemFailures: DynamoDBBatchResponse["batchItemFailures"] = [];
		for (const record of event.Records) {
			const save = newSaveInAll(record);
			if (save === undefined) continue;
			try {
				await intake(save);
			} catch (error) {
				logger.error("[smart-readlist-intake] record failed", { sequenceNumber: save.sequenceNumber, error });
				batchItemFailures.push({ itemIdentifier: save.sequenceNumber });
			}
		}
		return { batchItemFailures };
	};
}
