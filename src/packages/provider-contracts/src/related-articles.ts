import type { ArticleStatus, ReaderArticleHashId } from "@packages/domain/article";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";

export interface RelatedArticleLink {
	url: string;
	reason: string;
}

export type MarkRelatedArticlesOutcome = "stored" | "superseded";

export type MarkRelatedArticlesReady = (params: {
	userId: UserId;
	url: string;
	relatedArticles: readonly RelatedArticleLink[];
	inputTokens: number;
	outputTokens: number;
	at: Date;
}) => Promise<MarkRelatedArticlesOutcome>;

export type MarkRelatedArticlesSkipped = (params: {
	userId: UserId;
	url: string;
	at: Date;
}) => Promise<MarkRelatedArticlesOutcome>;

export interface RelatedArticleDisplay {
	id: ReaderArticleHashId;
	title: string;
	siteName: string;
	reason: string;
	status: ArticleStatus;
	savedAt: Date;
	readAt?: Date;
}

export type RelatedArticles =
	| { status: "pending" }
	| { status: "skipped" }
	| { status: "ready"; items: readonly RelatedArticleDisplay[] };

export type FindRelatedArticles = (params: {
	userId: UserId;
	url: string;
}) => Promise<RelatedArticles>;

export interface RelatedCandidate {
	url: string;
	title: string;
	siteName: string;
	description: string;
}

export interface RelatedCandidates {
	candidates: readonly RelatedCandidate[];
	awaitingCrawl: number;
}

export type FindRelatedCandidateArticles = (params: {
	userId: UserId;
	excludeUrl: string;
	limit: number;
}) => Promise<RelatedCandidates>;

export type FindRelatedReadCandidateArticles = (params: {
	userId: UserId;
	excludeUrl: string;
	limit: number;
}) => Promise<RelatedCandidates>;

export interface RelatedTargetArticle {
	crawlStatus: "pending" | "ready" | "failed" | "unsupported" | undefined;
	title: string;
	siteName: string;
	description: string;
	hasStubMetadata: boolean;
}

export type RelatedTargetLookup =
	| { state: "absent" }
	| { state: "purged" }
	| { state: "found"; article: RelatedTargetArticle };

export type FindRelatedTargetArticle = (
	url: string,
) => Promise<RelatedTargetLookup>;

// ---------------------------------------------------------------------------
// Previously-read-on-this-topic: an independent selection over the reader's
// past reads across every reading list. It reuses the relationship-sentence
// and display shape of Next read, but keeps its own persistence, its own
// fingerprint-guarded (recompute-safe, not terminal-once) write, and its own
// destination reading-list context so a match opens where its owner reads it.
// ---------------------------------------------------------------------------

/** A read candidate paired with the reading list it was gathered from
 * (absent = the default list), so a stored match can name where it lives. */
export interface ReadlistReadCandidate extends RelatedCandidate {
	readlist?: ReadlistSlug;
}

export interface ReadlistReadCandidates {
	candidates: readonly ReadlistReadCandidate[];
	awaitingCrawl: number;
}

export type FindReadCandidatesAcrossReadlists = (params: {
	userId: UserId;
	excludeUrl: string;
	limit: number;
}) => Promise<ReadlistReadCandidates>;

export interface PastReadLink {
	url: string;
	reason: string;
	readlist?: ReadlistSlug;
}

export type MarkPastReadsReady = (params: {
	userId: UserId;
	url: string;
	pastReads: readonly PastReadLink[];
	fingerprint: string;
	inputTokens: number;
	outputTokens: number;
	at: Date;
}) => Promise<MarkRelatedArticlesOutcome>;

/** The signature that a computation last ran against, so the worker can decide
 * whether the inputs changed without re-reading the whole candidate set twice. */
export interface PastReadsState {
	fingerprint?: string;
	computedAt?: Date;
}

export type ReadPastReadsState = (params: {
	userId: UserId;
	url: string;
}) => Promise<PastReadsState>;

export interface PastReadDisplay {
	id: ReaderArticleHashId;
	title: string;
	siteName: string;
	reason: string;
	/** When the reader last read this match, taken as the most recent read across
	 * every list it is still read in. Absent only for a legacy read row that
	 * carries no timestamp, so the reader omits the "last read" line rather than
	 * inventing one. */
	readAt?: Date;
	/** The reading list the reader should open this match in (absent = default). */
	readlist?: ReadlistSlug;
}

/** `ready` covers a cached empty result too — the reader hides the section when
 * `items` is empty rather than treating empty as a distinct state. */
export type PastReads =
	| { status: "pending" }
	| { status: "ready"; items: readonly PastReadDisplay[] };

export type FindPastReads = (params: {
	userId: UserId;
	url: string;
	sourceReadlist?: ReadlistSlug;
}) => Promise<PastReads>;
