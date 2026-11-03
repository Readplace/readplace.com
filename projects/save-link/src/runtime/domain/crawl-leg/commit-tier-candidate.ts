import type { CandidateId, CaptureTrigger, SaveAttemptId } from "@packages/domain/article";
import {
	RecrawlContentExtractedEvent,
	RefreshContentExtractedEvent,
	TierContentExtractedEvent,
	type LogCrawlOutcome,
	type RefreshContentExtractedDetail,
	type TierContentExtractedDetail,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { TierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import type { CandidateReference } from "../select-content/list-available-tier-sources";
import { candidateProvenance } from "../select-content/candidate-provenance";
import type { TierSourceMetadata } from "../select-content/tier-source.types";

export type CandidateLeg =
	| { tier: "tier-0"; kind: "extension"; captureTrigger: CaptureTrigger | undefined }
	| { tier: "tier-1"; kind: "live"; httpStatus?: number | undefined; renderedThrough?: TierSourceMetadata["renderedThrough"] }
	| { tier: "tier-2"; kind: "wrapper"; httpStatus: number | undefined };

export type CrawlOutcomeReport =
	| { report: "none" }
	| { report: "success" | "failed"; readSnapshot: () => Promise<TierSnapshot>; logCrawlOutcome: LogCrawlOutcome };

export type CandidateAnnouncement =
	| { event: "none" }
	| { event: "tier-content-extracted"; userId: TierContentExtractedDetail["userId"]; extractedAt: () => string }
	| { event: "recrawl-content-extracted"; extractedAt: () => string }
	| ({ event: "refresh-content-extracted" } & Pick<RefreshContentExtractedDetail, "etag" | "lastModified" | "contentFetchedAt" | "bodyHash">);

export type CommitTierCandidate = <Leg extends CandidateLeg>(params: {
	url: string;
	attemptId: SaveAttemptId;
	originalUrl: string;
	sourceUrl: string;
	fetchedAt: string;
	leg: Leg;
	metadata: TierSourceMetadata;
	html: string;
	evaluation: { hashed: string; stored: string | undefined };
	afterStore?: () => void | Promise<void>;
	crawlOutcome: CrawlOutcomeReport;
	priorCandidates?: readonly CandidateReference[];
	announce: CandidateAnnouncement | (() => CandidateAnnouncement);
}) => Promise<{ id: CandidateId; tier: Leg["tier"] }>;

export function initCommitTierCandidate(deps: { putTierSource: PutTierSource; publishEvent: PublishEvent }): CommitTierCandidate {
	return async (params) => {
		const { url, leg, evaluation, crawlOutcome } = params;
		const { tier, ...legProvenance } = leg;
		const metadata = candidateProvenance({
			metadata: params.metadata,
			html: params.html,
			evaluationHtml: evaluation.hashed,
			attemptId: params.attemptId,
			originalUrl: params.originalUrl,
			sourceUrl: params.sourceUrl,
			fetchedAt: params.fetchedAt,
			...legProvenance,
		});
		await deps.putTierSource({
			url,
			tier,
			html: params.html,
			metadata,
			...(evaluation.stored === undefined ? {} : { evaluationHtml: evaluation.stored }),
		});
		await params.afterStore?.();
		if (crawlOutcome.report !== "none") {
			const snapshot = await crawlOutcome.readSnapshot();
			crawlOutcome.logCrawlOutcome({
				url,
				thisTier: tier,
				thisTierStatus: crawlOutcome.report,
				otherTierStatus: tier === "tier-1" ? snapshot.tier0Status : snapshot.tier1Status,
				pickedTier: snapshot.pickedTier,
			});
		}
		const candidates = [...(params.priorCandidates ?? []), { id: metadata.id, tier }];
		const announce = typeof params.announce === "function" ? params.announce() : params.announce;
		if (announce.event === "tier-content-extracted") {
			await deps.publishEvent(TierContentExtractedEvent, {
				saveAttemptId: params.attemptId,
				candidates,
				url,
				userId: announce.userId,
				extractedAt: announce.extractedAt(),
			});
		}
		if (announce.event === "recrawl-content-extracted") {
			await deps.publishEvent(RecrawlContentExtractedEvent, {
				saveAttemptId: params.attemptId,
				candidates,
				url,
				extractedAt: announce.extractedAt(),
			});
		}
		if (announce.event === "refresh-content-extracted") {
			await deps.publishEvent(RefreshContentExtractedEvent, {
				saveAttemptId: params.attemptId,
				candidates,
				url,
				etag: announce.etag,
				lastModified: announce.lastModified,
				contentFetchedAt: announce.contentFetchedAt,
				bodyHash: announce.bodyHash,
			});
		}
		return { id: metadata.id, tier };
	};
}
