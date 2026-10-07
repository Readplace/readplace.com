import assert from "node:assert";
import { CandidateIdSchema, isArchiveHost, isWrapperUrl } from "@packages/domain/article";
import { ContentTierSchema } from "@packages/article-state-types";
import { canonicalIdentityOf } from "@packages/article-resource-unique-id";
import { dynamoField } from "@packages/hutch-storage-client";
import { z } from "zod";

export const VerificationFields = {
	originalUrl: dynamoField(z.string()),
	displayUrl: dynamoField(z.string()),
	contentSourceUrl: dynamoField(z.string()),
	directContentBeforePin: dynamoField(z.boolean()),
	contentSourceTier: dynamoField(ContentTierSchema),
	canonicalCandidateId: dynamoField(CandidateIdSchema),
	canonicalOriginalUrl: dynamoField(z.string()),
	revokedCandidateIds: dynamoField(z.set(CandidateIdSchema)),
};

const VerificationRow = z.object(VerificationFields);

export function isUnverifiedWrapperContent(row: z.infer<typeof VerificationRow>): boolean {
	if (row.canonicalCandidateId !== undefined && row.revokedCandidateIds?.has(row.canonicalCandidateId)) return true;
	if (row.canonicalCandidateId !== undefined) {
		assert(row.canonicalOriginalUrl, "a committed candidate always records its original URL");
		const originalUrl = row.displayUrl ?? row.originalUrl;
		return originalUrl !== undefined && canonicalIdentityOf(originalUrl) !== canonicalIdentityOf(row.canonicalOriginalUrl);
	}
	if ((row.contentSourceUrl !== undefined && row.directContentBeforePin !== true) || row.contentSourceTier === "tier-2") return true;
	if (row.originalUrl === undefined || !isWrapperUrl(row.originalUrl)) return false;
	return isArchiveHost(row.originalUrl) || row.displayUrl === undefined || isWrapperUrl(row.displayUrl);
}
