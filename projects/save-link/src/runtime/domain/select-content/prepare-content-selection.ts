import type { CandidateId, SaveAttemptId } from "@packages/domain/article";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { canonicalIdentityOf } from "@packages/article-resource-unique-id";
import { isWrapperUrl } from "@packages/domain/article";
import type { Article, LoadArticle } from "@packages/domain/article-aggregate";
import type { VerifyWrapperSource } from "@packages/save-article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { CrawlFailureReason } from "@packages/article-state-types";
import { CandidateProvenanceSchema, type CandidateProvenance, type VerifiedTierSource } from "./tier-source.types";
import type { Tier } from "./tier.types";
import type { ListAvailableTierSources, CandidateReference } from "./list-available-tier-sources";
import type { SelectMostCompleteContent, SelectionAudit } from "./select-content";
import { chooseTiedCandidate } from "./resolve-tie";
import { candidateProvenance } from "./candidate-provenance";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";
import type { FindArticleContent } from "../../providers/article-store/find-article-content";

export interface PreparedContentSelection {
	article: Article;
	originalUrl: string;
	sources: VerifiedTierSource[];
	selected: VerifiedTierSource | undefined;
	outcome: "selected" | "retained" | "no-readable";
	reason: string;
	readableIds: ReadonlySet<CandidateId>;
	audit?: SelectionAudit;
	legacyCanonicalWithheld: boolean;
}

const KIND_BY_TIER: Record<Tier, CandidateProvenance["kind"]> = { "tier-0": "extension", "tier-1": "live", "tier-2": "wrapper" };

function candidateIsReadable(source: VerifiedTierSource): boolean {
	return source.html.trim().length > 0 && (source.metadata.wordCount > 0 || /<(?:img|video|audio|iframe)\b/i.test(source.html));
}

function isSuccessStatus(httpStatus: number | undefined): boolean {
	return httpStatus === undefined || (httpStatus >= 200 && httpStatus < 300);
}

function firstCaptureOf(params: { article: Article; sources: readonly VerifiedTierSource[] }): VerifiedTierSource | undefined {
	const [only] = params.sources;
	const isFirstContent = params.article.freshness.canonicalContentHash === undefined;
	return only !== undefined && params.sources.length === 1 && isFirstContent && only.metadata.kind === "extension" ? only : undefined;
}

async function judgeCandidates(params: { sources: readonly VerifiedTierSource[]; originalUrl: string; selectMostCompleteContent: SelectMostCompleteContent }) {
	if (params.sources.length === 0) return { kind: "none", reason: "no verified candidates", readability: [] } as const;
	return params.selectMostCompleteContent({
		url: params.originalUrl,
		candidates: params.sources.map((source) => ({ id: source.metadata.id, tier: source.tier, title: source.metadata.title, wordCount: source.metadata.wordCount, html: source.evaluationHtml ?? source.html, httpStatus: source.metadata.httpStatus })),
	});
}

export function initPrepareContentSelection(deps: {
	loadArticle: LoadArticle;
	readCanonicalContent: FindArticleContent;
	listAvailableTierSources: ListAvailableTierSources;
	selectMostCompleteContent: SelectMostCompleteContent;
	resolveOriginalUrl: (url: string) => Promise<string>;
	verifyWrapperSource: VerifyWrapperSource;
}): (params: { url: string; candidates?: readonly CandidateReference[] }) => Promise<PreparedContentSelection> {
	return async ({ url, candidates }) => {
		const article = await deps.loadArticle(url);
		assert(article, `Article aggregate not found for url: ${url}`);
		const expected = article.contentSelection;
		const originalUrl = await deps.resolveOriginalUrl(url);
		const canonical = expected?.candidateId && expected.tier ? { id: expected.candidateId, tier: expected.tier } : undefined;
		const loaded = await deps.listAvailableTierSources(url, { candidates, canonical });
		const sources: VerifiedTierSource[] = [];
		const directContentUnpinned = expected?.contentSourceUrl === undefined || expected.directContentBeforePin === true;
		const legacyDirectTier = expected?.candidateId === undefined && directContentUnpinned && expected?.tier !== "tier-2" &&
			article.freshness.canonicalContentHash !== undefined &&
			(expected?.displayUrl === undefined || !isWrapperUrl(expected.displayUrl)) ? expected?.tier : undefined;
		let legacyCanonicalId: CandidateId | undefined;
		for (const source of loaded) {
			let sourceMetadata = source.metadata;
			if (sourceMetadata.id !== undefined && expected?.revokedCandidateIds?.includes(sourceMetadata.id)) continue;
			if (sourceMetadata.id === undefined && legacyDirectTier === source.tier &&
				computeCanonicalContentHash(source.html) === article.freshness.canonicalContentHash &&
				(sourceMetadata.sourceUrl === undefined || !isWrapperUrl(sourceMetadata.sourceUrl))) {
				sourceMetadata = candidateProvenance({ metadata: sourceMetadata, html: source.html, evaluationHtml: source.evaluationHtml ?? source.html, attemptId: "legacy-direct-canonical", originalUrl, sourceUrl: originalUrl, kind: KIND_BY_TIER[source.tier], fetchedAt: article.freshness.contentFetchedAt });
				legacyCanonicalId = sourceMetadata.id;
			}
			const parsed = CandidateProvenanceSchema.safeParse(sourceMetadata);
			if (!parsed.success) continue;
			const metadata = parsed.data;
			if (canonicalIdentityOf(metadata.originalUrl) !== canonicalIdentityOf(originalUrl)) continue;
			if (createHash("sha256").update(source.evaluationHtml ?? source.html).digest("hex") !== metadata.contentHash) continue;
			if (metadata.kind !== KIND_BY_TIER[source.tier]) continue;
			if (metadata.id !== canonical?.id && (metadata.kind === "wrapper" || isWrapperUrl(metadata.sourceUrl))) {
				const verified = await deps.verifyWrapperSource({ articleUrl: url, sourceUrl: metadata.sourceUrl, claimedOriginalUrl: metadata.originalUrl });
				if (verified === undefined) continue;
			}
			sources.push({ ...source, metadata });
		}
		const unverifiedLegacySource = loaded.some((source) => source.tier === expected?.tier && source.metadata.id === undefined && source.metadata.sourceUrl !== undefined && isWrapperUrl(source.metadata.sourceUrl));
		const legacyDirectSource = loaded.find((source) => source.tier === legacyDirectTier && source.metadata.id === undefined);
		let legacyCanonicalWithheld = false;
		if (!unverifiedLegacySource && legacyCanonicalId === undefined && legacyDirectTier !== undefined) {
			const persisted = await deps.readCanonicalContent(url);
			if (persisted !== undefined && computeCanonicalContentHash(persisted.content) === article.freshness.canonicalContentHash) {
				legacyCanonicalWithheld = legacyDirectTier === "tier-0" && legacyDirectSource === undefined;
				if (!legacyCanonicalWithheld) {
					const metadata = candidateProvenance({ metadata: { ...article.metadata, estimatedReadTime: article.estimatedReadTime, authorUserId: legacyDirectSource?.metadata.authorUserId }, html: persisted.content, evaluationHtml: persisted.content, attemptId: "legacy-direct-canonical", originalUrl, sourceUrl: originalUrl, kind: KIND_BY_TIER[legacyDirectTier], fetchedAt: article.freshness.contentFetchedAt });
					sources.push({ tier: legacyDirectTier, html: persisted.content, metadata });
					legacyCanonicalId = metadata.id;
				}
			}
		}
		const previous = sources.find((source) => source.metadata.id === (canonical?.id ?? legacyCanonicalId) && candidateIsReadable(source));
		const firstCapture = firstCaptureOf({ article, sources });
		const decision = firstCapture !== undefined
			? { kind: "winner", candidateId: firstCapture.metadata.id, reason: "the reader's capture is the article's first content", readability: [{ candidateId: firstCapture.metadata.id, readable: true }] } as const
			: await judgeCandidates({ sources, originalUrl, selectMostCompleteContent: deps.selectMostCompleteContent });
		const audit = "audit" in decision ? decision.audit : undefined;
		const chooseAmong = (tied: readonly VerifiedTierSource[]) => chooseTiedCandidate({
			sources: tied,
			canonicalId: previous?.metadata.id,
			freshIds: new Set(candidates?.map((candidate) => candidate.id)),
			canonicalNeedsRetry: article.summary.kind === "skipped" && article.summary.reason === "content-too-short",
		});
		let selected: VerifiedTierSource | undefined;
		if (decision.kind === "winner") selected = sources.find((source) => source.metadata.id === decision.candidateId);
		if (decision.kind === "tie") selected = chooseAmong(sources.filter((source) => decision.candidateIds.includes(source.metadata.id)));
		if (audit?.responseStatus === "rejected") {
			selected = chooseAmong(sources.filter((source) => isSuccessStatus(source.metadata.httpStatus) && candidateIsReadable(source)));
		}
		if (selected !== undefined && !candidateIsReadable(selected)) selected = undefined;
		const outcome = selected === undefined
			? previous === undefined ? "no-readable" : "retained"
			: selected.metadata.id === previous?.metadata.id ? "retained" : "selected";
		const readableIds = new Set(decision.readability.filter((assessment) => assessment.readable).map((assessment) => assessment.candidateId));
		return { article, originalUrl, sources, selected: selected ?? previous, outcome, reason: decision.reason, readableIds, audit, legacyCanonicalWithheld };
	};
}

export type LiveAttempt = { outcome: "body" | "no-body" | "deferred"; failureReason?: CrawlFailureReason };

export function initLogContentSelection(deps: { logger: HutchLogger }): (params: {
	saveAttemptId: SaveAttemptId;
	selection: PreparedContentSelection;
	liveAttempt?: LiveAttempt;
}) => void {
	return (params) => {
		const { selection } = params;
		deps.logger.info(`[ArchiveSaveAttempt] comparison completed ${JSON.stringify({
			saveAttemptId: params.saveAttemptId,
			url: selection.originalUrl,
			candidates: selection.sources.map((source) => ({
				id: source.metadata.id,
				kind: source.metadata.kind,
				originalUrl: source.metadata.originalUrl,
				sourceUrl: source.metadata.sourceUrl,
				contentHash: source.metadata.contentHash,
				httpStatus: source.metadata.httpStatus,
				readable: candidateIsReadable(source) && selection.readableIds.has(source.metadata.id),
				fresh: source.metadata.attemptId === params.saveAttemptId,
				fetchedAt: source.metadata.fetchedAt,
				evaluationLocation: source.metadata.evaluationLocation,
			})),
			selectedCandidateId: selection.selected?.metadata.id,
			outcome: selection.outcome,
			liveAttempt: params.liveAttempt,
			audit: selection.audit,
		})}`);
	};
}
