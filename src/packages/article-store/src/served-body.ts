import assert from "node:assert";
import type { ServedBody } from "@packages/domain/article";
import { dynamoField } from "@packages/hutch-storage-client";
import { z } from "zod";
import { VerificationFields, isUnverifiedWrapperContent } from "./verified-content";

export const ServedBodyFields = {
	...VerificationFields,
	contentLocation: dynamoField(z.string().regex(/^s3:\/\/[^/]+\/.+/)),
	purgedAt: dynamoField(z.string()),
};

const ServedBodyRow = z.object(ServedBodyFields);

export function servedBodyOf(row: z.infer<typeof ServedBodyRow>): ServedBody {
	if (row.purgedAt !== undefined || isUnverifiedWrapperContent(row)) return { kind: "withheld" };
	if (row.canonicalCandidateId === undefined) return { kind: "legacy" };
	assert(row.contentLocation, "a committed candidate always records its content location");
	return { kind: "committed", location: row.contentLocation };
}
