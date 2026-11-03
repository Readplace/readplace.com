import { createHash } from "node:crypto";
import { CandidateIdSchema, type CaptureTrigger, type SaveAttemptId } from "@packages/domain/article";
import type { CandidateProvenance, TierSourceMetadata } from "./tier-source.types";

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
