import { createHash } from "node:crypto";
import assert from "node:assert";
import { CandidateIdSchema, type CaptureTrigger, type SaveAttemptId, type WrapperFamily, isWrapperUrl, unwrapWrapperUrl, wrapperFamilyOf } from "@packages/domain/article";
import type { FindIdentityRow } from "@packages/provider-contracts/article-store";
import type { CandidateProvenance, TierSourceMetadata } from "./tier-source.types";

const OWN_ORIGINAL_IDENTITY_FAMILIES: ReadonlySet<WrapperFamily> = new Set(["apple-news", "archive-snapshot"]);

function standsAsItsOwnOriginal(url: string): boolean {
	const family = wrapperFamilyOf(url);
	return family !== undefined && OWN_ORIGINAL_IDENTITY_FAMILIES.has(family) && unwrapWrapperUrl(url).url === url;
}

export function candidateProvenance(params: {
	metadata: TierSourceMetadata;
	evaluationHtml: string;
	html: string;
	attemptId: SaveAttemptId | "legacy-direct-canonical";
	originalUrl: string;
	sourceUrl: string;
	kind: CandidateProvenance["kind"];
	fetchedAt: string;
	httpStatus?: number;
	captureTrigger?: CaptureTrigger;
	renderedThrough?: TierSourceMetadata["renderedThrough"];
}): CandidateProvenance {
	const contentHash = createHash("sha256").update(params.evaluationHtml).digest("hex");
	const id = CandidateIdSchema.parse(createHash("sha256")
		.update(JSON.stringify([params.attemptId, params.kind, params.originalUrl, params.sourceUrl, contentHash, createHash("sha256").update(params.html).digest("hex")]))
		.digest("hex"));
	return {
		...params.metadata,
		id,
		attemptId: params.attemptId,
		contentHash,
		originalUrl: params.originalUrl,
		sourceUrl: params.sourceUrl,
		kind: params.kind,
		fetchedAt: params.fetchedAt,
		httpStatus: params.httpStatus,
		captureTrigger: params.captureTrigger,
		...(params.renderedThrough === undefined ? {} : { renderedThrough: params.renderedThrough }),
	};
}

export function initResolveCandidateOriginal(deps: { findIdentityRow: FindIdentityRow }): (url: string) => Promise<string> {
	return async (url) => {
		const row = await deps.findIdentityRow(url);
		assert(row.kind === "article", "candidate must belong to an existing article");
		const originalUrl = row.originalUrl ?? url;
		assert(!isWrapperUrl(originalUrl) || standsAsItsOwnOriginal(originalUrl), "a wrapper cannot be the article identity");
		return originalUrl;
	};
}
