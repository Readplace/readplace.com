import { type DynamoDBDocumentClient, defineDynamoTable } from "@packages/storage-client";
import { z } from "zod";
import { OCR_PAGE_QUOTA_RULE, pagesLeftInWindow } from "@packages/domain/ocr-page-allowance";
import type { ReadOcrPagesLeft } from "@packages/provider-contracts/rate-limit";

const CounterRow = z.object({
	pk: z.string(),
	slots: z.array(z.object({ slotStart: z.number(), pages: z.number() })),
});

export function initDynamoDbOcrPagesLeft(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	tableName: string;
	now: () => Date;
}): { readOcrPagesLeft: ReadOcrPagesLeft } {
	const counters = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: CounterRow });

	const readOcrPagesLeft: ReadOcrPagesLeft = async ({ userId }) => {
		const counter = await counters.get({ pk: `ocr-pages#${userId}` });
		return pagesLeftInWindow({ slots: counter?.slots ?? [], nowMs: deps.now().getTime(), limit: OCR_PAGE_QUOTA_RULE.limit });
	};

	return { readOcrPagesLeft };
}
