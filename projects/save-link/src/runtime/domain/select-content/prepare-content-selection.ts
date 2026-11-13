import type { CandidateId, SaveAttemptId } from "@packages/domain/article";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { canonicalIdentityOf } from "@packages/article-resource-unique-id";
import { isWrapperUrl } from "@packages/domain/article";
import type { Article, LoadArticle } from "@packages/domain/article-aggregate";
import type { VerifyWrapperSource } from "@packages/save-article";
import type { Logger } from "@packages/logger";
import type { CrawlFailureReason } from "@packages/article-state-types";
import { CandidateProvenanceSchema, KIND_BY_TIER, LEGACY_DIRECT_CANONICAL_ATTEMPT_ID, candidateProvenance, type CandidateProvenance, type VerifiedTierSource } from "@packages/tier-source";
import type { ListAvailableTierSources, CandidateReference } from "./list-available-tier-sources";
import type { ContentDecision, SelectMostCompleteContent, SelectionAudit } from "./select-content";
import type { JudgeCandidates } from "./judge-under-ledger";
import { chooseTiedCandidate } from "./resolve-tie";
import { canonicalSupersedes } from "./canonical-supersedes";
import { refreshRefusalFor } from "./refresh-refusal";
import { COMPARISON_COMPLETED } from "./comparison-log";
import { computeCanonicalContentHash } from "../generate-summary/compute-canonical-content-hash";
import type { FindArticleContent } from "../save-link/article-content.types";

export type SelectionMode = "save" | "recrawl" | "refresh";

export interface PreparedContentSelection {
	article: Article;
	originalUrl: string;
	sources: VerifiedTierSource[];
	selected: VerifiedTierSource | undefined;
	outcome: "selected" | "retained" | "no-readable" | "refused";
	reason: string;
	selectionRule: "first-capture" | "superseded-by-canonical" | "direct-resource" | "unchanged-content" | "judge" | "provider-rejected-fallback" | "own-capture-over-verdict" | "lone-body" | "lone-error-status" | "judge-deferred" | "video-card-fallback" | "refresh-refused";
	ownCaptureFailed: boolean;
	readableIds: ReadonlySet<CandidateId>;
	audit?: SelectionAudit;
	legacyCanonicalWithheld: boolean;
	judgedBodies: number;
}

const EMPTY_TEXT_HASH = computeCanonicalContentHash("");
const LONE_BODY_MIN_WORDS = 100;

function candidateIsReadable(source: VerifiedTierSource): boolean {
	return source.html.trim().length > 0 && (source.metadata.wordCount > 0 || /<(?:img|video|audio|iframe)\b/i.test(source.html));
}

function isSuccessStatus(httpStatus: number | undefined): boolean {
	return httpStatus === undefined || (httpStatus >= 200 && httpStatus < 300);
}

function answeredWithError(httpStatus: number | undefined): boolean {
	return httpStatus !== undefined && httpStatus >= 400;
}

function isTapCapture(metadata: CandidateProvenance): boolean {
	return metadata.kind === "extension" && metadata.captureTrigger !== "automatic";
}

function firstCaptureOf(params: { isFirstContent: boolean; sources: readonly VerifiedTierSource[] }): VerifiedTierSource | undefined {
	const [only] = params.sources;
	return only !== undefined && params.sources.length === 1 && params.isFirstContent && isTapCapture(only.metadata) && !isWrapperUrl(only.metadata.sourceUrl) ? only : undefined;
}

function loneBodyOf(params: { isFirstContent: boolean; sources: readonly VerifiedTierSource[]; proseHashOf: (html: string) => string }): VerifiedTierSource[] | undefined {
	const [only, ...others] = params.isFirstContent ? groupByJudgedBody(params) : [];
	return only !== undefined && others.length === 0 && (params.sources.length === 1 || !only.some((source) => isTapCapture(source.metadata))) ? only : undefined;
}

function isOwnFreshCapture(params: { source: VerifiedTierSource; saveAttemptId: SaveAttemptId }): boolean {
	const { metadata } = params.source;
	return isTapCapture(metadata) && metadata.attemptId === params.saveAttemptId && !isWrapperUrl(metadata.sourceUrl) && candidateIsReadable(params.source);
}

function directResourcesOf(params: { sources: readonly VerifiedTierSource[]; saveAttemptId: SaveAttemptId }): VerifiedTierSource[] {
	return params.sources.filter((source) => source.tier === "tier-1" &&
		source.metadata.attemptId === params.saveAttemptId && source.metadata.directResourceKind !== undefined &&
		!isWrapperUrl(source.metadata.sourceUrl) && isSuccessStatus(source.metadata.httpStatus) && candidateIsReadable(source));
}

function representativeOf(members: readonly VerifiedTierSource[]): VerifiedTierSource {
	const [first] = members;
	assert(first, "a judged-body group holds at least one candidate");
	return members.find((source) => source.tier === "tier-1" && !isWrapperUrl(source.metadata.sourceUrl)) ?? first;
}

function expandVerdict(params: { decision: ContentDecision; withReadableMembers: (candidateId: CandidateId) => CandidateId[] }): ContentDecision {
	const { decision, withReadableMembers } = params;
	if (decision.kind === "none") return { kind: "none", reason: decision.reason };
	if (decision.kind === "tie") return { kind: "tie", candidateIds: decision.candidateIds.flatMap(withReadableMembers), reason: decision.reason };
	const [winner, ...tiedWith] = withReadableMembers(decision.candidateId);
	assert(winner, "a judged group always names at least its representative");
	return tiedWith.length > 0 ? { kind: "tie", candidateIds: [winner, ...tiedWith], reason: decision.reason } : { kind: "winner", candidateId: winner, reason: decision.reason };
}

function judgedBodyKeysOf(params: { source: VerifiedTierSource; proseHashOf: (html: string) => string }): string[] {
	const bytesKey = `bytes:${params.source.metadata.contentHash}`;
	const proseHash = params.proseHashOf(params.source.html);
	return proseHash === EMPTY_TEXT_HASH ? [bytesKey] : [bytesKey, `prose:${proseHash}`];
}

function groupByJudgedBody(params: { sources: readonly VerifiedTierSource[]; proseHashOf: (html: string) => string }): VerifiedTierSource[][] {
	const parentOf = new Map<string, string>();
	const rootOf = (key: string): string => {
		const parent = parentOf.get(key) ?? key;
		return parent === key ? key : rootOf(parent);
	};
	const keysOf = (source: VerifiedTierSource) => params.sources.length > 1 ? judgedBodyKeysOf({ source, proseHashOf: params.proseHashOf }) : [`bytes:${source.metadata.contentHash}`];
	for (const source of params.sources) {
		const [bytesRoot, ...otherRoots] = keysOf(source).map(rootOf);
		assert(bytesRoot, "a judged body always has a bytes key");
		for (const root of otherRoots) parentOf.set(root, bytesRoot);
	}
	const groups = new Map<string, VerifiedTierSource[]>();
	for (const source of params.sources) {
		const root = rootOf(`bytes:${source.metadata.contentHash}`);
		groups.set(root, [...(groups.get(root) ?? []), source]);
	}
	return [...groups.values()];
}

export async function judgeCandidates(params: { sources: readonly VerifiedTierSource[]; originalUrl: string; selectMostCompleteContent: SelectMostCompleteContent; proseHashOf: (html: string) => string }) {
	const groups = groupByJudgedBody({ sources: params.sources, proseHashOf: params.proseHashOf });
	const membersByRepresentative = new Map(groups.map((members) => [representativeOf(members).metadata.id, members]));
	const membersOf = (candidateId: CandidateId): VerifiedTierSource[] => {
		const members = membersByRepresentative.get(candidateId);
		assert(members, `the judge named a candidate that was not sent: ${candidateId}`);
		return members;
	};
	const judged = await params.selectMostCompleteContent({
		url: params.originalUrl,
		candidates: groups.map(representativeOf).map((source) => ({ id: source.metadata.id, tier: source.tier, title: source.metadata.title, wordCount: source.metadata.wordCount, html: source.evaluationHtml ?? source.html, httpStatus: source.metadata.httpStatus })),
	});
	const withReadableMembers = (candidateId: CandidateId) => {
		const readable = membersOf(candidateId).filter(candidateIsReadable).map((member) => member.metadata.id);
		return readable.length > 0 ? readable : [candidateId];
	};
	return {
		...expandVerdict({ decision: judged, withReadableMembers }),
		readability: judged.readability.flatMap((assessment) => membersOf(assessment.candidateId).map((member) => ({ candidateId: member.metadata.id, readable: assessment.readable }))),
		audit: judged.audit,
		judgedBodies: groups.length,
	};
}

export function initPrepareContentSelection(deps: {
	loadArticle: LoadArticle;
	readCanonicalContent: FindArticleContent;
	listAvailableTierSources: ListAvailableTierSources;
	judge: JudgeCandidates;
	resolveOriginalUrl: (url: string) => Promise<string>;
	verifyWrapperSource: VerifyWrapperSource;
}): (params: { url: string; saveAttemptId: SaveAttemptId; claimId: string; mode: SelectionMode; candidates?: readonly CandidateReference[]; refresh?: { contentFetchedAt: string }; beforeProviderCall?: () => void }) => Promise<PreparedContentSelection> {
	return async ({ url, saveAttemptId, claimId, mode, candidates, refresh, beforeProviderCall }) => {
		const proseHashes = new Map<string, string>();
		const proseHashOf = (html: string): string => {
			const known = proseHashes.get(html);
			if (known !== undefined) return known;
			const proseHash = computeCanonicalContentHash(html);
			proseHashes.set(html, proseHash);
			return proseHash;
		};
		const article = await deps.loadArticle(url);
		assert(article, `Article aggregate not found for url: ${url}`);
		const refusal = refresh === undefined ? undefined : refreshRefusalFor({ article, messageFetchedAt: refresh.contentFetchedAt });
		if (refusal !== undefined) return { article, originalUrl: url, sources: [], selected: undefined, outcome: "refused", reason: refusal, selectionRule: "refresh-refused", ownCaptureFailed: false, readableIds: new Set(), legacyCanonicalWithheld: false, judgedBodies: 0 };
		const expected = article.contentSelection;
		const originalUrl = await deps.resolveOriginalUrl(url);
		const canonical = expected?.candidateId && expected.tier ? { id: expected.candidateId, tier: expected.tier } : undefined;
		const loaded = await deps.listAvailableTierSources(url, { candidates, canonical });
		const sources: VerifiedTierSource[] = [];
		const directContentUnpinned = expected?.contentSourceUrl === undefined || expected.directContentBeforePin === true;
		const legacyDirectTier = !isWrapperUrl(originalUrl) && expected?.candidateId === undefined && directContentUnpinned && expected?.tier !== "tier-2" &&
			article.freshness.canonicalContentHash !== undefined &&
			(expected?.displayUrl === undefined || !isWrapperUrl(expected.displayUrl)) ? expected?.tier : undefined;
		let legacyCanonicalId: CandidateId | undefined;
		for (const source of loaded) {
			let sourceMetadata = source.metadata;
			if (sourceMetadata.id !== undefined && expected?.revokedCandidateIds?.includes(sourceMetadata.id)) continue;
			if (sourceMetadata.id === undefined && legacyDirectTier === source.tier &&
				proseHashOf(source.html) === article.freshness.canonicalContentHash &&
				(sourceMetadata.sourceUrl === undefined || !isWrapperUrl(sourceMetadata.sourceUrl))) {
				sourceMetadata = candidateProvenance({ metadata: sourceMetadata, html: source.html, evaluationHtml: source.evaluationHtml ?? source.html, attemptId: LEGACY_DIRECT_CANONICAL_ATTEMPT_ID, originalUrl, sourceUrl: originalUrl, kind: KIND_BY_TIER[source.tier], fetchedAt: article.freshness.contentFetchedAt });
				legacyCanonicalId = sourceMetadata.id;
			}
			const parsed = CandidateProvenanceSchema.safeParse(sourceMetadata);
			if (!parsed.success) continue;
			const metadata = parsed.data;
			const committedUnderOwnLink = metadata.id === canonical?.id && isWrapperUrl(metadata.sourceUrl) && canonicalIdentityOf(metadata.originalUrl) === canonicalIdentityOf(metadata.sourceUrl);
			if (!committedUnderOwnLink && canonicalIdentityOf(metadata.originalUrl) !== canonicalIdentityOf(originalUrl)) continue;
			if (createHash("sha256").update(source.evaluationHtml ?? source.html).digest("hex") !== metadata.contentHash) continue;
			if (metadata.kind !== KIND_BY_TIER[source.tier]) continue;
			if (metadata.id !== canonical?.id && (metadata.kind === "wrapper" || (isWrapperUrl(metadata.sourceUrl) && canonicalIdentityOf(metadata.sourceUrl) !== canonicalIdentityOf(originalUrl)))) {
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
			if (persisted !== undefined && proseHashOf(persisted.content) === article.freshness.canonicalContentHash) {
				legacyCanonicalWithheld = legacyDirectTier === "tier-0" && legacyDirectSource === undefined;
				if (!legacyCanonicalWithheld) {
					const metadata = candidateProvenance({ metadata: { ...article.metadata, estimatedReadTime: article.estimatedReadTime, authorUserId: legacyDirectSource?.metadata.authorUserId }, html: persisted.content, evaluationHtml: persisted.content, attemptId: LEGACY_DIRECT_CANONICAL_ATTEMPT_ID, originalUrl, sourceUrl: originalUrl, kind: KIND_BY_TIER[legacyDirectTier], fetchedAt: article.freshness.contentFetchedAt });
					sources.push({ tier: legacyDirectTier, html: persisted.content, metadata });
					legacyCanonicalId = metadata.id;
				}
			}
		}
		const previous = sources.find((source) => source.metadata.id === (canonical?.id ?? legacyCanonicalId) && candidateIsReadable(source));
		const isFirstContent = article.freshness.canonicalContentHash === undefined ||
			(article.freshness.canonicalContentHash === EMPTY_TEXT_HASH && previous === undefined);
		const firstCapture = firstCaptureOf({ isFirstContent, sources });
		const freshIds = new Set(candidates?.map((candidate) => candidate.id));
		const attemptResources = directResourcesOf({ sources, saveAttemptId });
		const supersededBy = (source: VerifiedTierSource) => canonicalSupersedes({ source, canonical: previous, saveAttemptId });
		const directResources = attemptResources.filter((source) => !supersededBy(source));
		const considered = mode === "recrawl" ? sources.filter((source) => freshIds.has(source.metadata.id)) : attemptResources;
		const superseded = considered.length > 0 && considered.every(supersededBy) ? previous : undefined;
		const proseUnchanged = previous !== undefined && sources.length > 1 &&
			sources.every((source) => proseHashOf(source.html) === article.freshness.canonicalContentHash && candidateIsReadable(source));
		const loneBodyMembers = loneBodyOf({ isFirstContent, sources, proseHashOf });
		const loneBody = loneBodyMembers === undefined ? undefined : representativeOf(loneBodyMembers);
		const loneBodyAnsweredWithError = loneBodyMembers?.some((member) => answeredWithError(member.metadata.httpStatus));
		const loneErrorStatus = loneBodyAnsweredWithError && sources.length === 1;
		const loneAccepted = loneBody !== undefined && !loneBodyAnsweredWithError && loneBody.metadata.wordCount >= LONE_BODY_MIN_WORDS && !isWrapperUrl(loneBody.metadata.sourceUrl);
		const decision = firstCapture !== undefined
			? { kind: "winner", candidateId: firstCapture.metadata.id, reason: "the reader's capture is the article's first content", readability: [{ candidateId: firstCapture.metadata.id, readable: true }], judgedBodies: 0 } as const
			: superseded !== undefined
			? { kind: "tie", candidateIds: [superseded.metadata.id], reason: "every considered candidate was fetched before the committed canonical", readability: [{ candidateId: superseded.metadata.id, readable: true }], judgedBodies: 0 } as const
			: directResources.length > 0
			? { kind: "tie", candidateIds: directResources.map((source) => source.metadata.id), reason: "verified direct resource fetched in this save attempt", readability: directResources.map((source) => ({ candidateId: source.metadata.id, readable: true })), judgedBodies: 0 } as const
			: proseUnchanged
			? { kind: "tie", candidateIds: sources.map((source) => source.metadata.id), reason: "prose unchanged from the canonical", readability: sources.map((source) => ({ candidateId: source.metadata.id, readable: true })), judgedBodies: 0 } as const
			: loneBody !== undefined && loneErrorStatus
			? { kind: "none", reason: `the only candidate answered HTTP ${loneBody.metadata.httpStatus}`, readability: [{ candidateId: loneBody.metadata.id, readable: false }], judgedBodies: 0 } as const
			: loneBody !== undefined && loneAccepted
			? { kind: "winner", candidateId: loneBody.metadata.id, reason: `the only candidate holds ${LONE_BODY_MIN_WORDS} words or more and the article has no content yet`, readability: sources.map((source) => ({ candidateId: source.metadata.id, readable: true })), judgedBodies: 0 } as const
			: await deps.judge({ url, originalUrl, sources, proseHashOf, claimId, beforeProviderCall });
		const audit = "audit" in decision ? decision.audit : undefined;
		const chooseAmong = (tied: readonly VerifiedTierSource[]) => chooseTiedCandidate({
			sources: tied,
			canonicalId: previous?.metadata.id,
			freshIds,
			canonicalNeedsRetry: article.summary.kind === "skipped" && article.summary.reason === "content-too-short",
		});
		let selected: VerifiedTierSource | undefined;
		let selectionRule: PreparedContentSelection["selectionRule"] = firstCapture !== undefined ? "first-capture" : superseded !== undefined ? "superseded-by-canonical" : directResources.length > 0 ? "direct-resource" : proseUnchanged ? "unchanged-content" : loneErrorStatus ? "lone-error-status" : loneAccepted ? "lone-body" : decision.kind === "deferred" ? "judge-deferred" : "judge";
		if (decision.kind === "winner") selected = sources.find((source) => source.metadata.id === decision.candidateId);
		if (decision.kind === "tie") selected = chooseAmong(sources.filter((source) => decision.candidateIds.includes(source.metadata.id)));
		if (audit?.responseStatus === "rejected") {
			selected = chooseAmong(sources.filter((source) => isSuccessStatus(source.metadata.httpStatus) && candidateIsReadable(source)));
			selectionRule = "provider-rejected-fallback";
		}
		if (selected !== undefined && !candidateIsReadable(selected)) selected = undefined;
		const ownCaptures = isFirstContent ? sources.filter((source) => isOwnFreshCapture({ source, saveAttemptId })) : [];
		if (decision.kind === "none" && selected === undefined && previous === undefined && ownCaptures.length > 0) {
			selected = chooseAmong(ownCaptures);
			selectionRule = "own-capture-over-verdict";
		}
		const outcome = selected === undefined
			? previous === undefined ? "no-readable" : "retained"
			: selected.metadata.id === previous?.metadata.id ? "retained" : "selected";
		const readableIds = new Set(decision.readability.filter((assessment) => assessment.readable).map((assessment) => assessment.candidateId));
		return {
			article, originalUrl, sources, selected: selected ?? previous, outcome, reason: decision.reason, selectionRule,
			ownCaptureFailed: outcome === "no-readable" && decision.kind !== "deferred" && ownCaptures.length > 0, readableIds, audit, legacyCanonicalWithheld, judgedBodies: decision.judgedBodies,
		};
	};
}

export type LiveAttempt = { outcome: "body" | "no-body" | "deferred"; failureReason?: CrawlFailureReason };

export function initLogContentSelection(deps: { logger: Logger }): (params: {
	saveAttemptId: SaveAttemptId;
	selection: PreparedContentSelection;
	liveAttempt?: LiveAttempt;
}) => void {
	return (params) => {
		const { selection } = params;
		deps.logger.info(`${COMPARISON_COMPLETED} ${JSON.stringify({
			saveAttemptId: params.saveAttemptId,
			url: selection.originalUrl,
			candidates: selection.sources.map((source) => ({
				id: source.metadata.id,
				kind: source.metadata.kind,
				captureTrigger: source.metadata.captureTrigger,
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
			selectionRule: selection.selectionRule,
			judgedBodies: selection.judgedBodies,
			reason: selection.reason,
			ownCaptureFailed: selection.ownCaptureFailed,
			liveAttempt: params.liveAttempt,
			audit: selection.audit,
		})}`);
	};
}
