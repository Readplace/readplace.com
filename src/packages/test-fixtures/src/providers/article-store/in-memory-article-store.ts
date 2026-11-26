import type { MarkRelatedPassesRequestedOutcome } from "@packages/provider-contracts/related-articles";
import assert from "node:assert";
import { createHash } from "node:crypto";
import type {
	ArticleDiscoveryQuery,
	ArticleMetadata,
	CandidateId,
	ArticleStatus,
	ItemMedia,
	Minutes,
	NewsletterLinkRow,
	SaveProvenance,
	SaveTrigger,
	SavedArticle,
	ServedBody,
} from "@packages/domain/article";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	type HeldLink,
	type SavedLinksJob,
	decideHold,
	heldLinkExpiresAt,
	isHeldLinkLive,
} from "@packages/domain/article";
import type {
	ChangePersonalPick,
	CountArticlesQuery,
	FindHeldLink,
	FindSavedLinksJob,
	FindOriginalUrls,
	FindKeysInAll,
	FindUnrestorableArticles,
	FinishSavedLinksJob,
	ForEachHeldLinkPage,
	HasHeldLinks,
	MoveNewsletterLinkToHold,
	RecordCountedNewsletterLinks,
	RecordSavedLinksJobProgress,
	RequestSavedLinksJob,
	RestoreHeldLink,
	WithdrawSavedLinksJob,
} from "@packages/provider-contracts/article-store";
import { type EventInstant, toEventInstant } from "@packages/domain/event-envelope";
import {
	personalDecisionKey,
	ReaderArticleHashId,
	articleDestinationUrl,
	ANONYMOUS_VIEWER,
	MinutesSchema,
	articleDisplayMetadata,
	discoveryCandidateOf,
	matchesArticleDiscovery,
	viewerFor,
	keepsProvenanceAgainstAutomaticSave,
} from "@packages/domain/article";
import {
	DEFAULT_READLIST_SLUG,
	READLIST_MAX_PER_USER,
	READLIST_FIT_OVERRIDES_KEPT,
	ReadlistLimitReachedError,
	type ReadlistFitOverrideId,
	type ReadlistSlug,
	readlistFitOverrideId,
} from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { MEDIA_KINDS } from "@packages/media-contracts";
import type {
	AllocateSavedAt,
	AllocateSavedAtSequence,
	AssignSavedArticleToReadlist,
	MoveReadlistArticles,
	FindSavedUrls,
	ArticleCrawlVersion,
	BumpArticleSavedAt,
	CountArticlesByUser,
	CountReadlistArticles,
	CreateReadlistDefinition,
	DeleteReadlistDefinition,
	DeleteReadlistFitOverride,
	DeleteReadlistArticleByUrl,
	DeleteAllUserArticles,
	DeleteArticle,
	DeleteReadlistArticle,
	FileIntoLiveReadlist,
	FindReadlistFiling,
	FindReadlistRemoval,
	PurgeReadlistArticle,
	ListReadlistDefinitions,
	ListReadlistFitOverrides,
	PurgeReadlistFitOverrides,
	ReadlistFitOverride,
	RecordReadlistFitOverride,
	PinReadlistDefinition,
	RenameReadlistDefinition,
	SetSmartReadlistRule,
	TurnOffSmartReadlistMatching,
	ReadlistFiling,
	FindSmartMatchRevisions,
	RecordSmartMatchRevision,
	UnpinReadlistDefinition,
	ListUserArticleUrls,
	ListUserSavesForUrl,
	FindQueueRowKeys,
	QueueRowKey,
	CountSmartReadlistArticles,
	ListUserSavesForUrls,
	FindArticleById,
	FindArticleByUrl,
	FindArticleCrawlVersions,
	FindArticleFreshness,
	FindArticleUrlById,
	FindArticlesAcrossReadlists,
	FindArticlesByUser,
	FindArticlesQuery,
	FindArticlesResult,
	FindReadlistArticleById,
	FindReadlistArticles,
	FindUnreadSavesForDigest,
	MarkArticleViewed,
	MarkReadlistArticleViewed,
	MarkReaderReadyEmailSent,
	MarkOcrPagesHeld,
	OcrPagesHold,
	MarkRelatedDismissed,
	MarkSummaryToggled,
	ContentProvider,
	FindItemOwner,
	ReadArticleImage,
	RecordPrivateItemFailure,
	RecordPrivateItemSections,
	RecordTranscriptOutcome,
	SaveArticle,
	SetArticleEnclosure,
	SaveArticleGlobally,
	SavePrivateItem,
	SaveArticleParams,
	SaveReadlistArticle,
	ClaimCanonicalAlias,
	FindIdentityRow,
	PinContentSource,
	WrapperSourceBinding,
	UpdateArticleStatus,
	UpdateArticleStatusAcrossReadlists,
} from "@packages/provider-contracts/article-store";
import {
	ArticlePurgedAfterRequest,
	DigestPageCursorSchema,
	type SaveArticleAsRequested,
	type SaveReadlistArticleAsRequested,
} from "@packages/provider-contracts/article-store";
import type { ReadCanonicalSnapshot } from "@packages/provider-contracts/canonical-snapshot";
import type { FindPersonalLibrary, SaveStarterPack } from "@packages/provider-contracts/engagement-starter";

interface GlobalArticle {
	url: string;
	originalUrl: string;
	displayUrl?: string;
	contentSourceUrl?: string;
	sourceOriginalUrl?: string;
	routeId: ReaderArticleHashId;
	metadata: ArticleMetadata;
	content?: string;

	estimatedReadTime: Minutes;
	savedAt: Date;
	summary?: string;
	etag?: string;
	lastModified?: string;
	contentFetchedAt?: string;
	bodyHash?: string;
	canonicalContentHash?: string;
	canonicalCandidateId?: CandidateId;
	contentSourceTier?: "tier-0" | "tier-1" | "tier-2";
	crawlVersions?: ArticleCrawlVersion[];
	purgedAt?: Date;
	readerAvailableAt?: Date;
	ownerUserId?: UserId;
	media?: ItemMedia;
	processingNotice?: string;
	enclosure?: SavedArticle["enclosure"];
}

interface UserArticle {
	statusRevision?: number;
	personalDecision?: string;
	personalPickedAt?: Date;
	bulkSave?: true;
	unknownOrigin?: true;
	personalScope?: "picked" | "uncertain";
	suggestionAttribution?: SavedArticle["suggestionAttribution"];
	userId: UserId;
	readlist?: ReadlistSlug;
	url: string;
	status: ArticleStatus;
	savedAt: Date;
	readAt?: Date;
	viewedAt?: Date;
	emailSentAt?: Date;
	lastSummaryOpenedAt?: Date;
	lastSummaryClosedAt?: Date;
	provenance?: SaveProvenance;
	handPickedAt?: Date;
	restoredAt?: Date;
	relatedDismissedAt?: Date;
	relatedDismissedSuggestionId?: ReaderArticleHashId;
	ocrPagesHold?: OcrPagesHold;
	relatedPassesRequestedAt?: Date;
}

function isProtectedAgainstAutomaticSave(row: UserArticle): boolean {
	return row.personalPickedAt !== undefined || row.handPickedAt !== undefined || keepsProvenanceAgainstAutomaticSave(row.provenance?.kind);
}

function servedBodyOf(article: GlobalArticle): ServedBody {
	if (article.purgedAt !== undefined) return { kind: "withheld" };
	if (article.content === undefined) return { kind: "legacy" };
	return { kind: "committed", location: `memory://content/${createHash("sha256").update(article.content).digest("hex")}` };
}

function toSavedArticle(article: GlobalArticle, userArticle: UserArticle): SavedArticle {
	const destinationUrl = articleDestinationUrl({ url: article.originalUrl, displayUrl: article.displayUrl });
	return {
		id: article.routeId,
		userId: userArticle.userId,
		url: article.originalUrl,
		destinationUrl,
		metadata: articleDisplayMetadata({
			url: article.originalUrl,
			destinationUrl,
			title: article.metadata.title,
			siteName: article.metadata.siteName,
			excerpt: article.metadata.excerpt,
			wordCount: article.metadata.wordCount,
			imageUrl: article.metadata.imageUrl,
			publishedOn: article.metadata.publishedOn,
			viewer: viewerFor(userArticle.userId),
			ownerUserId: article.ownerUserId,
		}),
		content: article.content,
		servedBody: servedBodyOf(article),
		estimatedReadTime: article.estimatedReadTime,
		status: userArticle.status,
		statusRevision: userArticle.statusRevision,
		savedAt: userArticle.savedAt,
		...(userArticle.bulkSave ? { bulkSave: true as const } : {}),
		lastSummaryOpenedAt: userArticle.lastSummaryOpenedAt,
		lastSummaryClosedAt: userArticle.lastSummaryClosedAt,
		restoredAt: userArticle.restoredAt,
		personalDecision: userArticle.personalDecision,
		personalPickedAt: userArticle.personalPickedAt,
		...(userArticle.personalScope === "uncertain" ? { personalReviewPending: true as const } : {}),
		readAt: userArticle.readAt,
		viewedAt: userArticle.viewedAt,
		contentFetchedAt: article.contentFetchedAt === undefined ? undefined : new Date(article.contentFetchedAt),
		provenance: userArticle.provenance,
		suggestionAttribution: userArticle.suggestionAttribution,
		relatedDismissedAt: userArticle.relatedDismissedAt,
		relatedDismissedSuggestionId: userArticle.relatedDismissedSuggestionId,
		media: article.media,
		processingNotice: article.processingNotice,
		ownerUserId: article.ownerUserId,
		enclosure: article.enclosure,
		ocrPagesHold: userArticle.ocrPagesHold,
	};
}

export function initInMemoryArticleStore(): {
	holdBulkArticle(userId: UserId, url: string, now: Date): (() => boolean) | undefined;
	markReadEverywhereForBulk(params: { userId: UserId; url: string; at: Date; isSelected: (article: SavedArticle) => boolean }): boolean;
	moveNewsletterLinkToHold: MoveNewsletterLinkToHold;
	findOriginalUrls: FindOriginalUrls;
	findUnrestorableArticles: FindUnrestorableArticles;
	findKeysInAll: FindKeysInAll;
	restoreHeldLink: RestoreHeldLink;
	forEachHeldLinkPage: ForEachHeldLinkPage;
	hasHeldLinks: HasHeldLinks;
	findHeldLink: FindHeldLink;
	requestSavedLinksJob: RequestSavedLinksJob;
	recordSavedLinksJobProgress: RecordSavedLinksJobProgress;
	recordCountedNewsletterLinks: RecordCountedNewsletterLinks;
	finishSavedLinksJob: FinishSavedLinksJob;
	findSavedLinksJob: FindSavedLinksJob;
	withdrawSavedLinksJob: WithdrawSavedLinksJob;
	findPersonalLibrary: FindPersonalLibrary;
	saveStarterPack: SaveStarterPack;
	changePersonalPick: ChangePersonalPick;
	saveArticle: SaveArticle;
	saveArticleKeepingPosition: SaveArticle;
	seedUncertainSave: (params: { userId: UserId; url: string }) => void;
	readHandPickedAt: (params: { userId: UserId; url: string }) => Date | undefined;
	readNewsletterLinkRows: (userId: UserId) => NewsletterLinkRow[];
	allocateSavedAt: AllocateSavedAt;
	allocateSavedAtSequence: AllocateSavedAtSequence;
	findSavedUrls: FindSavedUrls;
	saveArticleGlobally: SaveArticleGlobally;
	findArticleById: FindArticleById;
	findArticleByUrl: FindArticleByUrl;
	findArticleUrlById: FindArticleUrlById;
	findArticleFreshness: FindArticleFreshness;
	findArticleCrawlVersions: FindArticleCrawlVersions;
	findArticlesByUser: FindArticlesByUser;
	findArticlesAcrossReadlists: FindArticlesAcrossReadlists;
	countArticlesByUser: CountArticlesByUser;
	deleteArticle: DeleteArticle;
	onDefaultRowDeleted: (listener: (row: { userId: UserId; url: string }) => void) => void;
	readSavedRowRelatedRequest: (params: {
		userId: UserId;
		url: string;
	}) => Promise<{ requestedAt?: Date } | undefined>;
	stampRelatedPassesRequested: (params: {
		userId: UserId;
		url: string;
		at: Date;
	}) => Promise<MarkRelatedPassesRequestedOutcome>;
	deleteAllUserArticles: DeleteAllUserArticles;
	listUserArticleUrls: ListUserArticleUrls;
	updateArticleStatus: UpdateArticleStatus;
	markArticleViewed: MarkArticleViewed;
	markSummaryToggled: MarkSummaryToggled;
	markRelatedDismissed: MarkRelatedDismissed;
	markOcrPagesHeld: MarkOcrPagesHeld;
	markReaderReadyEmailSent: MarkReaderReadyEmailSent;
	findUnreadSavesForDigest: FindUnreadSavesForDigest;
	saveReadlistArticle: SaveReadlistArticle;
	saveArticleAsRequested: SaveArticleAsRequested;
	saveReadlistArticleAsRequested: SaveReadlistArticleAsRequested;
	findReadlistArticles: FindReadlistArticles;
	countReadlistArticles: CountReadlistArticles;
	findReadlistArticleById: FindReadlistArticleById;
	updateArticleStatusAcrossReadlists: UpdateArticleStatusAcrossReadlists;
	deleteReadlistArticle: DeleteReadlistArticle;
	purgeReadlistArticle: PurgeReadlistArticle;
	findReadlistFiling: FindReadlistFiling;
	findReadlistRemoval: FindReadlistRemoval;
	findSmartMatchRevisions: FindSmartMatchRevisions;
	recordSmartMatchRevision: RecordSmartMatchRevision;
	fileIntoLiveReadlist: FileIntoLiveReadlist;
	markReadlistArticleViewed: MarkReadlistArticleViewed;
	listUserSavesForUrl: ListUserSavesForUrl;
	findQueueRowKeys: FindQueueRowKeys;
	hasQueueRow: (key: QueueRowKey) => boolean;
	countSmartReadlistArticles: CountSmartReadlistArticles;
	listUserSavesForUrls: ListUserSavesForUrls;
	assignSavedArticleToReadlist: AssignSavedArticleToReadlist;
	moveReadlistArticles: MoveReadlistArticles;
	createReadlistDefinition: CreateReadlistDefinition;
	deleteReadlistDefinition: DeleteReadlistDefinition;
	recordReadlistFitOverride: RecordReadlistFitOverride;
	listReadlistFitOverrides: ListReadlistFitOverrides;
	deleteReadlistFitOverride: DeleteReadlistFitOverride;
	purgeReadlistFitOverrides: PurgeReadlistFitOverrides;
	deleteReadlistArticleByUrl: DeleteReadlistArticleByUrl;
	listReadlistDefinitions: ListReadlistDefinitions;
	renameReadlistDefinition: RenameReadlistDefinition;
	pinReadlistDefinition: PinReadlistDefinition;
	unpinReadlistDefinition: UnpinReadlistDefinition;
	setSmartReadlistRule: SetSmartReadlistRule;
	turnOffSmartReadlistMatching: TurnOffSmartReadlistMatching;
	/** Test-only accessor for the latest TL;DR open/close stamps, so route tests
	 * can assert the beacon reached the row. */
	getSummaryToggleState: (params: { userId: UserId; url: string }) => Promise<{
		lastSummaryOpenedAt?: Date;
		lastSummaryClosedAt?: Date;
	} | null>;
	readContent: ContentProvider;
	findItemOwner: FindItemOwner;
	recordItemOwner: (params: { url: string; ownerUserId: UserId }) => Promise<void>;
	savePrivateItem: SavePrivateItem;
	recordPrivateItemFailure: RecordPrivateItemFailure;
	recordPrivateItemSections: RecordPrivateItemSections;
	recordTranscriptOutcome: RecordTranscriptOutcome;
	setArticleEnclosure: SetArticleEnclosure;
	writeContent: (params: { url: string; content: string }) => Promise<void>;
	readArticleImage: ReadArticleImage;
	writeImage: (params: {
		url: string;
		filename: string;
		body: Buffer;
		contentType: string;
	}) => Promise<void>;
	writeMetadata: (params: { url: string; metadata: ArticleMetadata; estimatedReadTime: Minutes }) => Promise<void>;
	setContentSourceTier: (params: { url: string; tier: "tier-0" | "tier-1" | "tier-2" }) => Promise<void>;
	setContentFetchedAt: (params: { url: string; at: string }) => Promise<void>;
	setCanonicalContentHash: (params: { url: string; canonicalContentHash: string }) => Promise<void>;
	readCanonicalSnapshot: ReadCanonicalSnapshot;
	replaceCanonicalContent: (params: {
		url: string;
		content: string;
		canonicalContentHash: string;
		canonicalCandidateId: CandidateId;
	}) => Promise<void>;
	setDisplayUrl: (params: { url: string; displayUrl: string }) => Promise<void>;
	claimAlias: ClaimCanonicalAlias;
	resolveAlias: (url: string) => Promise<string | undefined>;
	findIdentityRow: FindIdentityRow;
	pinContentSource: PinContentSource;
	findAdoptedFetchUrl: (url: string) => Promise<string | undefined>;
	findContentSourceUrl: (url: string) => Promise<string | undefined>;
	setCrawlVersions: (params: { url: string; versions: ArticleCrawlVersion[] }) => Promise<void>;
	setPurgedAt: (params: { url: string; at: Date }) => Promise<void>;
	setReaderAvailableAt: (params: { url: string; at: Date }) => Promise<void>;
	setReadlistArticleStatus: (params: {
		id: ReaderArticleHashId;
		userId: UserId;
		readlist: ReadlistSlug;
		status: ArticleStatus;
	}) => Promise<void>;
} {
	const articles = new Map<string, GlobalArticle>();
	const articleImages = new Map<string, { body: Buffer; contentType: string }>();
	const userArticles = new Map<string, UserArticle>();
	const removalTimes = new Map<string, { userId: UserId; at: Date }>();
	const defaultRowDeletedListeners: ((row: { userId: UserId; url: string }) => void)[] = [];
	const announceDefaultRowDeleted = (row: { userId: UserId; url: string }) => {
		for (const listener of defaultRowDeletedListeners) listener(row);
	};
	const saveCursors = new Map<UserId, number>();
	const heldLinks = new Map<
		string,
		{ userId: UserId; row: UserArticle; readlistRows: { readlist: ReadlistSlug; row: UserArticle }[]; link: HeldLink }
	>();
	const savedLinksJobs = new Map<UserId, SavedLinksJob>();
	const readlistDefinitions = new Map<
		string,
		{
			userId: UserId;
			slug: ReadlistSlug;
			label: string;
			purpose?: string;
			createdAt: Date;
			starterCampaignId?: string;
			pinnedAt?: Date;
			filingMode?: "manual" | "smart";
			filingRuleRevision?: number;
			filingRuleEffectiveAt?: Date;
		}
	>();
	const readlistFitOverrides = new Map<
		string,
		{ userId: UserId; readlist: ReadlistSlug; override: ReadlistFitOverride }
	>();
	const readlistRemovals = new Map<string, { userId: UserId; removedAt: EventInstant }>();
	const readlistRemovalKey = (removal: { userId: UserId; readlist: ReadlistSlug; url: string }) =>
		`${userArticleKey(removal.userId, ArticleResourceUniqueId.parse(removal.url).value)}|${removal.readlist}`;
	const recordReadlistRemoval = (removal: { userId: UserId; readlist: ReadlistSlug; url: string }) => {
		if (!userArticles.has(userArticleKey(removal.userId, ArticleResourceUniqueId.parse(removal.url).value))) return;
		readlistRemovals.set(readlistRemovalKey(removal), { userId: removal.userId, removedAt: toEventInstant(new Date()) });
	};
	const smartMatchRevisions = new Map<string, { userId: UserId; readlist: ReadlistSlug; revision: number }>();
	const forgetAllRowMarkers = (allKey: string) => {
		for (const key of readlistRemovals.keys()) {
			if (key.startsWith(`${allKey}|`)) readlistRemovals.delete(key);
		}
		for (const key of smartMatchRevisions.keys()) {
			if (key.startsWith(`${allKey}|`)) smartMatchRevisions.delete(key);
		}
	};
	const findPersonalLibrary: FindPersonalLibrary = async (userId) => {
		const own = [...userArticles.values()].filter((row) => row.userId === userId);
		const personal = own.filter(
			(row) => row.provenance?.kind !== "hn-suggestion" && row.provenance?.kind !== "founder-seed",
		);
		return {
			urls: [...new Set(own.map((row) => row.url))],
			personalCount: new Set(personal.map((row) => row.url)).size,
		};
	};
	const saveStarterPack: SaveStarterPack = async ({ userId, pack, savedAt }) => {
		assert(pack.picks.length === 10 && savedAt.length === 10, "starter packs contain ten articles");
		const ids = pack.picks.map((pick) => ArticleResourceUniqueId.parse(pick.url).value);
		const alreadySaved = ids.some((id) =>
			[undefined, pack.readlist].some((readlist) =>
				userArticles.has(userArticleKey(userId, id, readlist)),
			),
		);
		if (readlistDefinitions.has(readlistDefinitionKey(userId, pack.readlist)) || alreadySaved) {
			return "conflict";
		}
		readlistDefinitions.set(readlistDefinitionKey(userId, pack.readlist), {
			userId,
			slug: pack.readlist,
			label: pack.readlistLabel,
			starterCampaignId: pack.campaignId,
			createdAt: new Date(pack.selectedAt),
		});
		pack.picks.forEach((pick, index) => {
			const position = savedAt[index];
			assert(position, "each pick has a saved position");
			const url = ArticleResourceUniqueId.parse(pick.url).value;
			const suggestionAttribution = {
				campaignId: pack.campaignId,
				snapshotAt: pick.snapshotAt,
				hnItemId: pick.hnItemId,
				rank: pick.rank,
			};
			for (const readlist of [undefined, pack.readlist]) {
				userArticles.set(userArticleKey(userId, url, readlist), {
					userId,
					readlist,
					url,
					savedAt: position,
					status: "unread",
					provenance: { kind: "hn-suggestion", ...suggestionAttribution },
					suggestionAttribution,
				});
			}
		});
		return "inserted";
	};

	const allocateSavedAtSequence: AllocateSavedAtSequence = async ({ userId, count }) => {
		assert(count > 0, "a savedAt sequence allocates at least one instant");
		const nowMs = Date.now();
		const cursor = saveCursors.get(userId);
		const startMs = cursor === undefined || cursor < nowMs ? nowMs : cursor + 1;
		saveCursors.set(userId, startMs + count - 1);
		return Array.from({ length: count }, (_, i) => new Date(startMs + i));
	};

	const allocateSavedAt: AllocateSavedAt = async ({ userId }) => {
		const [instant] = await allocateSavedAtSequence({ userId, count: 1 });
		assert(instant, "a one-instant sequence yields exactly one instant");
		return instant;
	};

	const findSavedUrls: FindSavedUrls = async ({ userId, urls }) =>
		urls.filter((url) =>
			userArticles.has(userArticleKey(userId, ArticleResourceUniqueId.parse(url).value)),
		);

	function userArticleKey(userId: UserId, url: string, readlist?: ReadlistSlug): string {
		return readlist === undefined ? `${userId}:${url}` : `${userId}#readlist/${readlist}:${url}`;
	}

	function readlistDefinitionKey(userId: UserId, slug: ReadlistSlug): string {
		return `${userId}:${slug}`;
	}

	function findArticleByRouteId(routeId: ReaderArticleHashId): GlobalArticle | undefined {
		for (const article of articles.values()) {
			if (article.routeId.value === routeId.value) return article;
		}
		return undefined;
	}

	const saveArticleGlobally: SaveArticleGlobally = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const existing = articles.get(articleResourceUniqueId.value);
		// A live (non-purged) row is a no-op upsert; a tombstoned row is revived
		// clean, mirroring the store's conditional put that clears purgedAt.
		if (existing && existing.purgedAt === undefined) {
			return { created: false };
		}
		setFreshArticle(params, existing);
		return { created: true };
	};

	function setFreshArticle(params: Parameters<SaveArticleGlobally>[0], existing: GlobalArticle | undefined): void {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		articles.set(articleResourceUniqueId.value, {
			url: articleResourceUniqueId.value,
			originalUrl: params.url,
			displayUrl: existing?.displayUrl,
			routeId: ReaderArticleHashId.from(params.url),
			metadata: params.metadata,
			estimatedReadTime: params.estimatedReadTime,
			savedAt: params.savedAt,
		});
	}

	const bumpArticleSavedAt: BumpArticleSavedAt = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const article = articles.get(articleResourceUniqueId.value);
		if (!article) return;
		article.savedAt = params.savedAt;
	};

	const changePersonalPick: ChangePersonalPick = async ({ userId, url, picked, request }) => {
		const key = userArticleKey(userId, ArticleResourceUniqueId.parse(url).value);
		const row = userArticles.get(key);
		if (!row) return "missing";
		const decision = personalDecisionKey(request);
		const removed = removalTimes.get(key);
		if (removed && removed.at.getTime() >= new Date(request.requestedAt).getTime()) return "superseded";
		if (row.personalDecision !== undefined && row.personalDecision >= decision) return "superseded";
		row.personalDecision = decision;
		row.personalPickedAt = picked ? row.personalPickedAt ?? new Date(request.requestedAt) : undefined;
		row.personalScope = picked ? "picked" : undefined;
		return "updated";
	};

	const saveInto = async (
		readlist: ReadlistSlug | undefined,
		params: Omit<SaveArticleParams, "saveTrigger">,
		saveTrigger: SaveTrigger | undefined,
	) => {
		const globallySavedAt = new Date();
		const { created } = await saveArticleGlobally({
			url: params.url,
			metadata: params.metadata,
			estimatedReadTime: params.estimatedReadTime,
			savedAt: globallySavedAt,
		});
		if (!created) {
			await bumpArticleSavedAt({ url: params.url, savedAt: globallySavedAt });
		}
		return writeUserRowUnless({
			readlist,
			params,
			saveTrigger,
			overtakes: (existing) => existing.savedAt.getTime() >= params.savedAt.getTime(),
		});
	};

	const writeUserRowUnless = async ({
		readlist,
		params,
		saveTrigger,
		overtakes,
	}: {
		readlist: ReadlistSlug | undefined;
		params: Pick<SaveArticleParams, "userId" | "url" | "savedAt" | "provenance" | "suggestionAttribution" | "personalPick" | "bulkSave">;
		saveTrigger: SaveTrigger | undefined;
		overtakes: (existing: UserArticle) => boolean;
	}) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);

		const uaKey = userArticleKey(params.userId, articleResourceUniqueId.value, readlist);
		const removal = removalTimes.get(uaKey);
		if (params.personalPick && removal && new Date(params.personalPick.requestedAt).getTime() <= removal.at.getTime()) throw new ArticlePurgedAfterRequest(params.url);
		const existing = userArticles.get(uaKey);
		const newerSaveWon = existing !== undefined && overtakes(existing);
		if (!newerSaveWon) {
			userArticles.set(uaKey, existing
				? {
					...existing,
					...(params.bulkSave ? { bulkSave: true as const } : {}),
					savedAt: params.savedAt,
					provenance:
						saveTrigger === "automatic" && isProtectedAgainstAutomaticSave(existing)
							? existing.provenance
							: params.provenance,
					suggestionAttribution: existing.suggestionAttribution ?? params.suggestionAttribution,
					handPickedAt: saveTrigger === "manual" ? existing.handPickedAt ?? params.savedAt : existing.handPickedAt,
				}
				: {
					...(params.bulkSave ? { bulkSave: true as const } : {}),
					userId: params.userId,
					readlist,
					url: articleResourceUniqueId.value,
					status: "unread",
					savedAt: params.savedAt,
					provenance: params.provenance,
					suggestionAttribution: params.suggestionAttribution,
					...(saveTrigger === "manual" ? { handPickedAt: params.savedAt } : {}),
				});
		} else if (saveTrigger === "manual") {
			userArticles.set(uaKey, { ...existing, handPickedAt: existing.handPickedAt ?? params.savedAt });
		}

		const article = articles.get(articleResourceUniqueId.value);
		assert(article, "Article must exist after set");
		if (params.personalPick && readlist === undefined) {
			await changePersonalPick({ userId: params.userId, url: params.url, picked: true, request: params.personalPick });
		}
		const ua = userArticles.get(uaKey);
		assert(ua, "User article must exist after set");
		return {
			saved: toSavedArticle(article, ua),
			createdUserArticle: existing === undefined,
			wroteUserArticle: !newerSaveWon,
		};
	};

	const saveReadlistArticle: SaveReadlistArticle = ({ readlist, ...params }) => saveInto(readlist, params, undefined);

	const saveAsRequested = async (
		readlist: ReadlistSlug | undefined,
		{ requestedAt, ...params }: Omit<SaveArticleParams, "saveTrigger"> & { requestedAt: Date },
		saveTrigger: SaveTrigger | undefined,
	) => {
		const key = ArticleResourceUniqueId.parse(params.url).value;
		const removal = removalTimes.get(userArticleKey(params.userId, key, readlist));
		if (removal && removal.at >= requestedAt) throw new ArticlePurgedAfterRequest(params.url);
		const existingArticle = articles.get(key);
		const globallySavedAt = new Date();
		if (existingArticle === undefined || (existingArticle.purgedAt !== undefined && existingArticle.purgedAt < requestedAt)) {
			setFreshArticle(
				{ url: params.url, metadata: params.metadata, estimatedReadTime: params.estimatedReadTime, savedAt: globallySavedAt },
				existingArticle,
			);
		} else if (existingArticle.purgedAt !== undefined) {
			throw new ArticlePurgedAfterRequest(params.url);
		} else {
			existingArticle.savedAt = globallySavedAt;
		}
		return writeUserRowUnless({
			readlist,
			params,
			saveTrigger,
			overtakes: (existing) =>
				existing.savedAt >= requestedAt || (existing.readAt !== undefined && existing.readAt >= requestedAt),
		});
	};

	const saveArticleAsRequested: SaveArticleAsRequested = ({ saveTrigger, ...params }) =>
		saveAsRequested(undefined, params, saveTrigger);

	const saveArticle: SaveArticle = ({ saveTrigger, ...params }) => {
		const requestedAt = params.requestedAt ?? (params.personalPick && new Date(params.personalPick.requestedAt));
		return requestedAt ? saveAsRequested(undefined, { ...params, requestedAt }, saveTrigger) : saveInto(undefined, params, saveTrigger);
	};

	const saveReadlistArticleAsRequested: SaveReadlistArticleAsRequested = ({ readlist, ...params }) =>
		saveAsRequested(readlist, params, undefined);

	const readHandPickedAt = ({ userId, url }: { userId: UserId; url: string }): Date | undefined =>
		userArticles.get(userArticleKey(userId, ArticleResourceUniqueId.parse(url).value))?.handPickedAt;

	const readNewsletterLinkRows = (userId: UserId): NewsletterLinkRow[] =>
		[...userArticles.values()]
			.filter((row) => row.userId === userId && row.readlist === undefined)
			.map((row) => ({
				storedKey: row.url,
				status: row.status,
				savedAt: row.savedAt,
				...(row.provenance === undefined ? {} : { provenance: row.provenance }),
				...(row.restoredAt === undefined ? {} : { restoredAt: row.restoredAt }),
			}));

	const saveArticleKeepingPosition: SaveArticle = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const existing = userArticles.get(userArticleKey(params.userId, articleResourceUniqueId.value));
		if (existing === undefined) return saveArticle(params);
		if (params.saveTrigger === "manual") {
			userArticles.set(userArticleKey(params.userId, articleResourceUniqueId.value), {
				...existing,
				handPickedAt: existing.handPickedAt ?? params.savedAt,
			});
		}

		if (params.personalPick) {
			await changePersonalPick({ userId: params.userId, url: params.url, picked: true, request: params.personalPick });
		}
		const globallySavedAt = new Date();
		const { created } = await saveArticleGlobally({
			url: params.url,
			metadata: params.metadata,
			estimatedReadTime: params.estimatedReadTime,
			savedAt: globallySavedAt,
		});
		if (!created) {
			await bumpArticleSavedAt({ url: params.url, savedAt: globallySavedAt });
		}
		const article = articles.get(articleResourceUniqueId.value);
		assert(article, "Article must exist after set");
		const current = userArticles.get(userArticleKey(params.userId, articleResourceUniqueId.value));
		assert(current);
		return { saved: toSavedArticle(article, current), createdUserArticle: false, wroteUserArticle: false };
	};

	const findArticleById: FindArticleById = async (id, userId) => {
		const article = findArticleByRouteId(id);
		if (!article) return null;

		const ua = userArticles.get(userArticleKey(userId, article.url));
		if (!ua) return null;

		return toSavedArticle(article, ua);
	};

	const findReadlistArticleById: FindReadlistArticleById = async ({ id, userId, readlist }) => {
		const article = findArticleByRouteId(id);
		if (!article) return null;

		const ua = userArticles.get(userArticleKey(userId, article.url, readlist));
		if (!ua) return null;

		return toSavedArticle(article, ua);
	};

	const findArticleUrlById: FindArticleUrlById = async (id) => {
		const article = findArticleByRouteId(id);
		return article ? article.originalUrl : null;
	};

	const findArticleByUrl: FindArticleByUrl = async (url, viewer = ANONYMOUS_VIEWER) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const article = articles.get(articleResourceUniqueId.value);
		if (!article) return null;

		const destinationUrl = articleDestinationUrl({ url: article.originalUrl, displayUrl: article.displayUrl });
		return {
			id: article.routeId,
			url: article.originalUrl,
			destinationUrl,
			metadata: articleDisplayMetadata({
				url: article.originalUrl,
				destinationUrl,
				title: article.metadata.title,
				siteName: article.metadata.siteName,
				excerpt: article.metadata.excerpt,
				wordCount: article.metadata.wordCount,
				imageUrl: article.metadata.imageUrl,
				publishedOn: article.metadata.publishedOn,
				viewer,
				ownerUserId: article.ownerUserId,
			}),
			content: article.content,

			estimatedReadTime: article.estimatedReadTime,
			savedAt: article.savedAt,
			contentSourceTier: article.contentSourceTier,
			media: article.media,
			purgedAt: article.purgedAt,
			readerAvailableAt: article.readerAvailableAt,
		};
	};

	const discoveredRows = (userArts: UserArticle[], discovery: ArticleDiscoveryQuery): SavedArticle[] =>
		userArts
			.map((ua) => {
				const article = articles.get(ua.url);
				assert(article, "every saved row has a global article");
				return toSavedArticle(article, ua);
			})
			.filter((saved) => matchesArticleDiscovery(discoveryCandidateOf(saved), discovery));

	const matchesManagedOrigin = (row: UserArticle, origin: FindArticlesQuery["managedOrigin"]) => {
		if (origin === "bulk") return row.bulkSave || row.provenance?.kind === "import";
		if (origin === "unknown") return row.unknownOrigin || row.provenance === undefined;
		return true;
	};

	const listPartition = async (
		readlist: ReadlistSlug | undefined,
		query: FindArticlesQuery,
	): Promise<FindArticlesResult> => {
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;
		const order = query.order ?? "desc";
		const sort = query.sort ?? "savedAt";

		let userArts = Array.from(userArticles.values()).filter(
			(ua) => ua.userId === query.userId && ua.readlist === readlist && (query.personalScope === undefined || ua.personalScope === query.personalScope) && matchesManagedOrigin(ua, query.managedOrigin),
		);

		if (query.status) {
			userArts = userArts.filter((ua) => ua.status === query.status);
		}

		userArts.sort((a, b) => {
			const aValue = sort === "readAt" || (query.personalScope && query.status === "read") ? a.readAt : (query.personalScope && a.personalPickedAt) || a.savedAt;
			const bValue = sort === "readAt" || (query.personalScope && query.status === "read") ? b.readAt : (query.personalScope && b.personalPickedAt) || b.savedAt;
			assert(aValue, "sort field must be set on every row matching this query");
			assert(bValue, "sort field must be set on every row matching this query");
			const diff = aValue.getTime() - bValue.getTime() || (query.personalScope ? ReaderArticleHashId.fromResourceUniqueId(a.url).value.localeCompare(ReaderArticleHashId.fromResourceUniqueId(b.url).value) : 0);
			return order === "asc" ? diff : -diff;
		});

		if (query.discovery) {
			const matched = discoveredRows(userArts, query.discovery);
			const start = (page - 1) * pageSize;
			return {
				articles: matched.slice(start, start + pageSize),
				total: matched.length,
				hasMore: matched.length > start + pageSize,
				page,
				pageSize,
			};
		}

		const total = query.includeTotal ? userArts.length : undefined;
		const start = (page - 1) * pageSize;
		const paginated = userArts.slice(start, start + pageSize);
		const hasMore = userArts.length > start + pageSize;

		const result: SavedArticle[] = [];
		for (const ua of paginated) {
			const article = articles.get(ua.url);
			if (article) {
				result.push(toSavedArticle(article, ua));
			}
		}

		return { articles: result, total, hasMore, page, pageSize };
	};

	const findArticlesByUser: FindArticlesByUser = (query) => listPartition(undefined, query);

	const findReadlistArticles: FindReadlistArticles = (query) => listPartition(query.readlist, query);

	const findArticlesAcrossReadlists: FindArticlesAcrossReadlists = async (query) => {
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;
		const order = query.order ?? "desc";
		const sort = query.sort ?? "savedAt";

		const owned = await listReadlistDefinitions(query.userId);
		const rank = new Map<ReadlistSlug | undefined, number>([[undefined, 0]]);
		owned.forEach((definition, index) => {
			rank.set(definition.slug, index + 1);
		});

		const byUrl = new Map<string, { representative: UserArticle; latestSavedAt: Date }>();
		for (const ua of userArticles.values()) {
			if (ua.userId !== query.userId) continue;
			const ownedRank = rank.get(ua.readlist);
			if (ownedRank === undefined) continue;
			const existing = byUrl.get(ua.url);
			if (existing === undefined) {
				byUrl.set(ua.url, { representative: ua, latestSavedAt: ua.savedAt });
				continue;
			}
			const existingRank = rank.get(existing.representative.readlist);
			assert(existingRank !== undefined, "the representative must sit in an owned readlist");
			if (ownedRank < existingRank) existing.representative = ua;
			if (ua.savedAt.getTime() > existing.latestSavedAt.getTime()) {
				existing.latestSavedAt = ua.savedAt;
			}
		}

		let entries = [...byUrl.values()];
		if (query.status) {
			entries = entries.filter((entry) => entry.representative.status === query.status);
		}
		entries.sort((a, b) => {
			const aValue = sort === "readAt" ? a.representative.readAt : a.latestSavedAt;
			const bValue = sort === "readAt" ? b.representative.readAt : b.latestSavedAt;
			assert(aValue, "sort field must be set on every row matching this query");
			assert(bValue, "sort field must be set on every row matching this query");
			const diff = aValue.getTime() - bValue.getTime();
			if (diff !== 0) return order === "asc" ? diff : -diff;
			const aArticle = articles.get(a.representative.url);
			const bArticle = articles.get(b.representative.url);
			assert(aArticle && bArticle, "every saved row has a global article");
			return aArticle.routeId.value.localeCompare(bArticle.routeId.value);
		});

		const total = query.includeTotal ? entries.length : undefined;
		const start = (page - 1) * pageSize;
		const pageEntries = entries.slice(start, start + pageSize);
		const hasMore = entries.length > start + pageSize;

		const result: SavedArticle[] = [];
		for (const entry of pageEntries) {
			const article = articles.get(entry.representative.url);
			assert(article, "every saved row has a global article");
			result.push(toSavedArticle(article, { ...entry.representative, savedAt: entry.latestSavedAt }));
		}
		return { articles: result, total, hasMore, page, pageSize };
	};

	const countPartition = (
		readlist: ReadlistSlug | undefined,
		query: CountArticlesQuery,
	): number => {
		let userArts = Array.from(userArticles.values()).filter(
			(ua) => ua.userId === query.userId && ua.readlist === readlist && (query.personalScope === undefined || ua.personalScope === query.personalScope) && matchesManagedOrigin(ua, query.managedOrigin),
		);
		if (query.status) {
			userArts = userArts.filter((ua) => ua.status === query.status);
		}
		const counted = query.discovery
			? discoveredRows(userArts, query.discovery).length
			: userArts.length;
		return Math.min(counted, query.countLimit ?? counted);
	};

	const countArticlesByUser: CountArticlesByUser = async (query) => countPartition(undefined, query);

	const countReadlistArticles: CountReadlistArticles = async (query) => countPartition(query.readlist, query);

	const deleteFrom = (
		readlist: ReadlistSlug | undefined,
		id: ReaderArticleHashId,
		userId: UserId,
	): boolean => {
		const article = findArticleByRouteId(id);
		if (!article) return false;

		const uaKey = userArticleKey(userId, article.url, readlist);
		if (!userArticles.has(uaKey)) return false;

		userArticles.delete(uaKey);
		if (readlist === undefined) {
			removalTimes.set(uaKey, { userId, at: new Date() });
			forgetAllRowMarkers(uaKey);
			announceDefaultRowDeleted({ userId, url: article.originalUrl });
		}
		return true;
	};

	function holdBulkArticle(userId: UserId, url: string, now: Date) {
		const article = articles.get(ArticleResourceUniqueId.parse(url).value);
		if (!article || article.purgedAt) return undefined;
		const key = userArticleKey(userId, article.url);
		const original = userArticles.get(key);
		if (!original || !deleteFrom(undefined, article.routeId, userId)) return undefined;
		const removal = { userId, at: now };
		removalTimes.set(key, removal);
		return () => {
			if (removalTimes.get(key) !== removal || userArticles.has(key) || articles.get(article.url) !== article || article.purgedAt) return false;
			userArticles.set(key, { ...original, restoredAt: new Date() });
			return true;
		};
	}

	const deleteArticle: DeleteArticle = async (id, userId) => deleteFrom(undefined, id, userId);

	const readSavedRowRelatedRequest = async ({ userId, url }: { userId: UserId; url: string }) => {
		const row = userArticles.get(userArticleKey(userId, ArticleResourceUniqueId.parse(url).value));
		if (row === undefined) return undefined;
		return row.relatedPassesRequestedAt === undefined ? {} : { requestedAt: row.relatedPassesRequestedAt };
	};

	const stampRelatedPassesRequested = async ({ userId, url, at }: { userId: UserId; url: string; at: Date }) => {
		const key = userArticleKey(userId, ArticleResourceUniqueId.parse(url).value);
		const row = userArticles.get(key);
		if (row === undefined) return "row-absent" as const;
		userArticles.set(key, { ...row, relatedPassesRequestedAt: row.relatedPassesRequestedAt ?? at });
		return "marked" as const;
	};

	const deleteReadlistArticle: DeleteReadlistArticle = async ({ id, userId, readlist }) => {
		const article = findArticleByRouteId(id);
		if (article) recordReadlistRemoval({ userId, readlist, url: article.originalUrl });
		return deleteFrom(readlist, id, userId);
	};

	const purgeReadlistArticle: PurgeReadlistArticle = async ({ id, userId, readlist }) =>
		deleteFrom(readlist, id, userId);

	const findReadlistFiling: FindReadlistFiling = async ({ userId, readlist, url }) => {
		const row = userArticles.get(userArticleKey(userId, ArticleResourceUniqueId.parse(url).value, readlist));
		if (row === undefined) return undefined;
		return { savedAt: row.savedAt, status: row.status, readAt: row.readAt };
	};

	const findReadlistRemoval: FindReadlistRemoval = async (params) =>
		readlistRemovals.get(readlistRemovalKey(params))?.removedAt;

	const findSmartMatchRevisions: FindSmartMatchRevisions = async ({ userId, storedKey }) => {
		const allKey = userArticleKey(userId, storedKey);
		const row = userArticles.get(allKey);
		if (row === undefined) return { kind: "not-in-all" };
		const revisions = new Map<ReadlistSlug, number>();
		for (const [key, marker] of smartMatchRevisions) {
			if (key.startsWith(`${allKey}|`)) revisions.set(marker.readlist, marker.revision);
		}
		return { kind: "in-all", savedAt: row.savedAt, revisions };
	};

	const recordSmartMatchRevision: RecordSmartMatchRevision = async ({ userId, storedKey, readlist, revision }) => {
		const allKey = userArticleKey(userId, storedKey);
		if (!userArticles.has(allKey)) return { recorded: false };
		const key = `${allKey}|${readlist}`;
		const existing = smartMatchRevisions.get(key);
		if (existing !== undefined && existing.revision >= revision) return { recorded: false };
		smartMatchRevisions.set(key, { userId, readlist, revision });
		return { recorded: true };
	};

	const fileIntoLiveReadlist: FileIntoLiveReadlist = async (params) => {
		const definition = readlistDefinitions.get(readlistDefinitionKey(params.userId, params.readlist));
		if (params.smartRule !== undefined) {
			const ruleHolds =
				definition?.filingMode === "smart" && definition.filingRuleRevision === params.smartRule.revision;
			if (!ruleHolds) return { outcome: "smart-rule-changed" };
		}
		if (definition === undefined) {
			return { outcome: "readlist-gone" };
		}
		if (!userArticles.has(userArticleKey(params.userId, ArticleResourceUniqueId.parse(params.url).value))) {
			return { outcome: "not-in-all" };
		}
		const removal = readlistRemovals.get(readlistRemovalKey(params));
		if (removal !== undefined && removal.removedAt > toEventInstant(params.requestedAt)) {
			return { outcome: "removed-after-request" };
		}
		const landsAs = params.landsAs;
		if (landsAs.status === "read") {
			const key = userArticleKey(params.userId, ArticleResourceUniqueId.parse(params.url).value, params.readlist);
			if (userArticles.has(key)) return { outcome: "newer-row-won" };
			userArticles.set(key, {
				userId: params.userId,
				readlist: params.readlist,
				url: ArticleResourceUniqueId.parse(params.url).value,
				status: "read",
				readAt: landsAs.readAt,
				savedAt: params.savedAt,
				provenance: params.provenance,
				suggestionAttribution: params.suggestionAttribution,
			});
		} else {
			const { wroteUserArticle } = await writeUserRowUnless({
				readlist: params.readlist,
				params,
				saveTrigger: undefined,
				overtakes: (existing) => existing.savedAt.getTime() >= params.savedAt.getTime(),
			});
			if (!wroteUserArticle) return { outcome: "newer-row-won" };
		}
		await bumpArticleSavedAt({ url: params.url, savedAt: new Date() });
		return { outcome: "filed" };
	};

	const deleteAllUserArticles: DeleteAllUserArticles = async (userId) => {
		for (const [key, ua] of userArticles) {
			if (ua.userId === userId) userArticles.delete(key);
		}
		for (const [key, definition] of readlistDefinitions) {
			if (definition.userId === userId) readlistDefinitions.delete(key);
		}
		for (const [key, entry] of readlistFitOverrides) {
			if (entry.userId === userId) readlistFitOverrides.delete(key);
		}
		for (const [key, removal] of removalTimes) {
			if (removal.userId === userId) removalTimes.delete(key);
		}
		for (const [key, removal] of readlistRemovals) {
			if (removal.userId === userId) readlistRemovals.delete(key);
		}
		for (const [key, marker] of smartMatchRevisions) {
			if (marker.userId === userId) smartMatchRevisions.delete(key);
		}
		saveCursors.delete(userId);
		for (const [key, held] of heldLinks) {
			if (held.userId === userId) heldLinks.delete(key);
		}
		savedLinksJobs.delete(userId);
	};

	const listUserArticleUrls: ListUserArticleUrls = async (userId) => {
		const urls = new Set<string>();
		const storedKeys = [
			...[...userArticles.values()].filter((ua) => ua.userId === userId).map((ua) => ua.url),
			...[...heldLinks.values()].filter((held) => held.userId === userId).map((held) => held.link.storedKey),
		];
		for (const storedKey of storedKeys) {
			const article = articles.get(storedKey);
			if (article) urls.add(article.originalUrl);
		}
		return [...urls];
	};

	const heldLinkMapKey = (params: { userId: UserId; heldKey: string }) => `${params.userId}|${params.heldKey}`;

	const findUnrestorableArticles: FindUnrestorableArticles = async ({ storedKeys }) =>
		new Set(storedKeys.filter((storedKey) => articles.get(storedKey)?.purgedAt !== undefined || !articles.has(storedKey)));

	const findKeysInAll: FindKeysInAll = async ({ userId, storedKeys }) =>
		new Set(storedKeys.filter((storedKey) => userArticles.has(userArticleKey(userId, storedKey))));

	const findOriginalUrls: FindOriginalUrls = async ({ storedKeys }) => {
		const found = new Map<string, string>();
		for (const storedKey of storedKeys) {
			const article = articles.get(storedKey);
			if (article !== undefined) found.set(storedKey, article.originalUrl);
		}
		return found;
	};

	const moveNewsletterLinkToHold: MoveNewsletterLinkToHold = async ({ userId, jobId, storedKey, cutoff, senders, readlists, now }) => {
		const allKey = userArticleKey(userId, storedKey);
		const row = userArticles.get(allKey);
		if (row === undefined) return { outcome: "not-selected" };
		const decision = decideHold({ row: { ...row, storedKey }, userId, cutoff, senders });
		if (decision.kind === "not-selected") return { outcome: "not-selected" };
		if (decision.kind === "skipped") return { outcome: "skipped", reason: decision.reason };
		assert(row.provenance?.kind === "email", "a held link carries email provenance");
		const heldKey = `readplace:removed/${jobId}/${createHash("sha256").update(storedKey).digest("hex")}`;
		const link = {
			heldKey,
			storedKey,
			jobId,
			removedAt: now,
			expiresAt: heldLinkExpiresAt(now),
			senderEmail: row.provenance.senderEmail,
		};
		const readlistRows = readlists.flatMap((readlist) => {
			const copy = userArticles.get(userArticleKey(userId, storedKey, readlist));
			return copy === undefined ? [] : [{ readlist, row: copy }];
		});
		removalTimes.set(allKey, { userId, at: now });
		userArticles.delete(allKey);
		for (const { readlist } of readlistRows) userArticles.delete(userArticleKey(userId, storedKey, readlist));
		forgetAllRowMarkers(allKey);
		heldLinks.set(heldLinkMapKey({ userId, heldKey }), { userId, row, readlistRows, link });
		return { outcome: "held" };
	};

	const restoreHeldLink: RestoreHeldLink = async ({ userId, heldKey, now }) => {
		const held = heldLinks.get(heldLinkMapKey({ userId, heldKey }));
		if (held === undefined) return { outcome: "gone" };
		const article = articles.get(held.link.storedKey);
		assert(article, "a held link's shared article is kept in memory");
		if (article.purgedAt !== undefined) return { outcome: "unrestorable" };
		const allKey = userArticleKey(userId, held.link.storedKey);
		if (userArticles.has(allKey)) return { outcome: "already-in-all" };
		if (held.link.expiresAt <= now) return { outcome: "gone" };
		const removal = removalTimes.get(allKey);
		if (removal && removal.at.getTime() !== held.link.removedAt.getTime()) return { outcome: "unrestorable" };
		userArticles.set(allKey, { ...held.row, restoredAt: now });
		for (const { readlist, row } of held.readlistRows) {
			if (readlistDefinitions.has(readlistDefinitionKey(userId, readlist))) {
				userArticles.set(userArticleKey(userId, held.link.storedKey, readlist), row);
			}
		}
		heldLinks.delete(heldLinkMapKey({ userId, heldKey }));
		return { outcome: "restored" };
	};

	const liveHeldLinks = (params: { userId: UserId; now: Date }): HeldLink[] =>
		[...heldLinks.values()]
			.filter((held) => held.userId === params.userId && isHeldLinkLive({ link: held.link, now: params.now }))
			.map((held) => held.link);

	const forEachHeldLinkPage: ForEachHeldLinkPage = async ({ userId, now, onPage }) => {
		await onPage(liveHeldLinks({ userId, now }));
	};

	const hasHeldLinks: HasHeldLinks = async (params) => liveHeldLinks(params).length > 0;

	const findHeldLink: FindHeldLink = async ({ userId, storedKey, now }) =>
		liveHeldLinks({ userId, now }).find((link) => link.storedKey === storedKey);

	const isOpenJob = (job: SavedLinksJob) => job.state === "requested" || job.state === "running";

	const requestSavedLinksJob: RequestSavedLinksJob = async ({ userId, jobId, action, requestedAt }) => {
		const open = savedLinksJobs.get(userId);
		if (open !== undefined && isOpenJob(open) && open.action !== "count") return { outcome: "busy", job: open };
		savedLinksJobs.set(userId, { jobId, action, state: "requested", requestedAt, counts: {} });
		return { outcome: "claimed" };
	};

	const jobHeldBy = (params: { userId: UserId; jobId: SavedLinksJob["jobId"] }) => {
		const job = savedLinksJobs.get(params.userId);
		return job?.jobId === params.jobId ? job : undefined;
	};

	const recordSavedLinksJobProgress: RecordSavedLinksJobProgress = async ({ userId, jobId, counts }) => {
		const job = jobHeldBy({ userId, jobId });
		if (job === undefined || job.state === "completed") return { outcome: "stale" };
		const { finishedAt: _finishedAt, ...resumed } = job;
		savedLinksJobs.set(userId, { ...resumed, state: "running", counts });
		return { outcome: "recorded" };
	};

	const recordCountedNewsletterLinks: RecordCountedNewsletterLinks = async ({ userId, jobId, counted }) => {
		const job = jobHeldBy({ userId, jobId });
		if (job === undefined || job.state === "completed") return { outcome: "stale" };
		savedLinksJobs.set(userId, { ...job, counted });
		return { outcome: "recorded" };
	};

	const finishSavedLinksJob: FinishSavedLinksJob = async ({ userId, jobId, state, counts, finishedAt }) => {
		const job = jobHeldBy({ userId, jobId });
		if (job === undefined || job.state === "completed") return { outcome: "stale" };
		savedLinksJobs.set(userId, { ...job, state, counts, finishedAt });
		return { outcome: "recorded" };
	};

	const findSavedLinksJob: FindSavedLinksJob = async ({ userId }) => savedLinksJobs.get(userId);

	const withdrawSavedLinksJob: WithdrawSavedLinksJob = async ({ userId, jobId }) => {
		const job = jobHeldBy({ userId, jobId });
		if (job?.state !== "requested") return { outcome: "stale" };
		savedLinksJobs.delete(userId);
		return { outcome: "withdrawn" };
	};

	const assignSavedArticleToReadlist: AssignSavedArticleToReadlist = async ({
		userId,
		readlist,
		from,
		url,
		savedAt,
	}) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const partitionKey = (slug: ReadlistSlug) =>
			slug === DEFAULT_READLIST_SLUG
				? userArticleKey(userId, articleResourceUniqueId.value)
				: userArticleKey(userId, articleResourceUniqueId.value, slug);
		const source = userArticles.get(partitionKey(from));
		if (!source) return { assigned: false };
		const targetKey = partitionKey(readlist);
		if (userArticles.has(targetKey)) return { assigned: false };
		const targetReadlist = readlist === DEFAULT_READLIST_SLUG ? undefined : readlist;
		const { relatedPassesRequestedAt: _assignedAcknowledgement, personalDecision: _decision, personalPickedAt: _picked, personalScope: _scope, ...assigned } = source;
		userArticles.set(targetKey, { ...assigned, readlist: targetReadlist, savedAt });
		return { assigned: true };
	};

	const moveReadlistArticles: MoveReadlistArticles = async ({ userId, from, to }) => {
		let moved = 0;
		for (const source of [...userArticles.values()]) {
			if (source.userId !== userId || source.readlist !== from) continue;
			const targetKey = userArticleKey(userId, source.url, to);
			if (!userArticles.has(targetKey)) {
				const { relatedPassesRequestedAt: _movedAcknowledgement, ...moving } = source;
				userArticles.set(targetKey, { ...moving, readlist: to });
				moved += 1;
			}
			userArticles.delete(userArticleKey(userId, source.url, from));
		}
		return { moved };
	};

	const listUserSavesForUrl: ListUserSavesForUrl = async ({ userId, url }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const saves: { readlist?: ReadlistSlug }[] = [];
		for (const ua of userArticles.values()) {
			if (ua.userId !== userId || ua.url !== articleResourceUniqueId.value) continue;
			saves.push(ua.readlist === undefined ? {} : { readlist: ua.readlist });
		}
		return saves;
	};

	const queueRowKeyOf = (ua: UserArticle): QueueRowKey => ({
		userId: ua.readlist === undefined ? ua.userId : `${ua.userId}#queue/${ua.readlist}`,
		url: ua.url,
	});

	const findQueueRowKeys: FindQueueRowKeys = async ({ userId, urls }) => {
		const keys = new Set(urls.map((url) => ArticleResourceUniqueId.parse(url).value));
		return [...userArticles.values()]
			.filter((ua) => ua.userId === userId && keys.has(ua.url))
			.map(queueRowKeyOf);
	};

	const hasQueueRow = (key: QueueRowKey): boolean =>
		[...userArticles.values()].some((ua) => {
			const candidate = queueRowKeyOf(ua);
			return candidate.userId === key.userId && candidate.url === key.url;
		});

	const countSmartReadlistArticles: CountSmartReadlistArticles = async ({ userId, readlists }) => {
		const urls = new Set<string>();
		for (const row of userArticles.values()) {
			if (row.userId === userId && row.readlist && readlists.includes(row.readlist)) {
				if (!readlistDefinitions.get(readlistDefinitionKey(userId, row.readlist))?.purpose) continue;
				urls.add(row.url);
				if (urls.size === 10) break;
			}
		}
		return urls.size;
	};

	const listUserSavesForUrls: ListUserSavesForUrls = async ({ userId, urls, readlists }) => {
		const saves = new Map<string, { readlist?: ReadlistSlug; picked?: true }[]>();
		for (const url of urls) {
			const picked = userArticles.get(userArticleKey(userId, ArticleResourceUniqueId.parse(url).value))?.personalPickedAt !== undefined;
			const memberships = (await listUserSavesForUrl({ userId, url })).map((save) =>
				save.readlist === undefined && picked ? { ...save, picked: true as const } : save,
			);
			saves.set(url, readlists === undefined ? memberships : memberships.filter(
				(save) => readlists.includes(save.readlist ?? DEFAULT_READLIST_SLUG),
			));
		}
		return saves;
	};

	const updateStatusIn = (
		readlist: ReadlistSlug | undefined,
		id: ReaderArticleHashId,
		userId: UserId,
		status: ArticleStatus,
		readAt: Date,
		expected?: Parameters<UpdateArticleStatus>[3],
	): SavedArticle | null => {
		const article = findArticleByRouteId(id);
		if (!article) return null;

		const uaKey = userArticleKey(userId, article.url, readlist);
		const ua = userArticles.get(uaKey);
		if (!ua) return null;
		if (expected && (ua.savedAt.getTime() !== expected.savedAt.getTime() || ua.readAt?.getTime() !== expected.readAt?.getTime()
			|| ua.statusRevision !== expected.statusRevision)) return toSavedArticle(article, ua);

		if (ua.status !== status || !ua.personalScope) ua.statusRevision = (ua.statusRevision ?? 0) + 1;
		ua.status = status;
		if (status === "read") {
			ua.readAt = ua.readAt ?? readAt;
		} else {
			ua.readAt = undefined;
		}
		userArticles.set(uaKey, ua);
		return toSavedArticle(article, ua);
	};

	function markReadEverywhereForBulk(params: { userId: UserId; url: string; at: Date; isSelected: (article: SavedArticle) => boolean }): boolean {
		const article = articles.get(ArticleResourceUniqueId.parse(params.url).value);
		const source = article && userArticles.get(userArticleKey(params.userId, article.url));
		if (!article || article.purgedAt || !source || !params.isSelected(toSavedArticle(article, source))) return false;
		const unread = [...userArticles.values()].filter((row) => row.userId === params.userId && row.url === article.url && row.status === "unread"
			&& (row.readlist === undefined || readlistDefinitions.has(readlistDefinitionKey(params.userId, row.readlist))));
		for (const row of unread) updateStatusIn(row.readlist, article.routeId, params.userId, "read", params.at);
		return true;
	}

	const updateArticleStatus: UpdateArticleStatus = async (id, userId, status, expected) =>
		updateStatusIn(undefined, id, userId, status, new Date(), expected);

	const setReadlistArticleStatus = async (params: {
		id: ReaderArticleHashId;
		userId: UserId;
		readlist: ReadlistSlug;
		status: ArticleStatus;
	}): Promise<void> => {
		const updated = updateStatusIn(params.readlist, params.id, params.userId, params.status, new Date());
		assert(updated, "setReadlistArticleStatus needs the readlist to already hold the article");
	};

	const updateArticleStatusAcrossReadlists: UpdateArticleStatusAcrossReadlists = async ({
		id,
		userId,
		addressed,
		status,
	}) => {
		const addressedReadlist = addressed === DEFAULT_READLIST_SLUG ? undefined : addressed;
		const readAt = new Date();
		const updated = updateStatusIn(addressedReadlist, id, userId, status, readAt);
		if (!updated) return null;
		const saves = await listUserSavesForUrl({ userId, url: updated.url });
		for (const save of saves) {
			if (save.readlist === addressedReadlist) continue;
			updateStatusIn(save.readlist, id, userId, status, readAt);
		}
		return updated;
	};

	const createReadlistDefinition: CreateReadlistDefinition = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const owned = [...readlistDefinitions.values()].filter((d) => d.userId === params.userId);
		if (owned.length >= READLIST_MAX_PER_USER) throw new ReadlistLimitReachedError(READLIST_MAX_PER_USER);
		const key = readlistDefinitionKey(params.userId, params.slug);
		if (readlistDefinitions.has(key)) return { created: false, ownedCount: owned.length };
		readlistDefinitions.set(key, {
			userId: params.userId,
			slug: params.slug,
			label: params.label,
			createdAt: params.createdAt,
			filingMode: "manual",
		});
		return { created: true, ownedCount: owned.length + 1 };
	};

	const renameReadlistDefinition: RenameReadlistDefinition = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const definition = readlistDefinitions.get(readlistDefinitionKey(params.userId, params.slug));
		if (!definition) return { renamed: false };
		definition.label = params.label;
		return { renamed: true };
	};

	const pinReadlistDefinition: PinReadlistDefinition = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const definition = readlistDefinitions.get(readlistDefinitionKey(params.userId, params.slug));
		if (!definition) return { pinned: false };
		definition.pinnedAt ??= params.pinnedAt;
		return { pinned: true };
	};

	const unpinReadlistDefinition: UnpinReadlistDefinition = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const definition = readlistDefinitions.get(readlistDefinitionKey(params.userId, params.slug));
		if (!definition) return { unpinned: false };
		definition.pinnedAt = undefined;
		return { unpinned: true };
	};

	const setSmartReadlistRule: SetSmartReadlistRule = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const definition = readlistDefinitions.get(readlistDefinitionKey(params.userId, params.slug));
		if (!definition) return { kind: "readlist-gone" };
		const revision = (definition.filingRuleRevision ?? 0) + 1;
		definition.filingMode = "smart";
		definition.purpose = params.purpose;
		definition.filingRuleRevision = revision;
		definition.filingRuleEffectiveAt = params.effectiveAt;
		return { kind: "set", revision };
	};

	const turnOffSmartReadlistMatching: TurnOffSmartReadlistMatching = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const definition = readlistDefinitions.get(readlistDefinitionKey(params.userId, params.slug));
		if (definition?.filingMode !== "smart") return { turnedOff: false };
		assert(definition.filingRuleRevision !== undefined, "a smart readlist carries its rule revision");
		definition.filingMode = "manual";
		definition.filingRuleRevision += 1;
		definition.filingRuleEffectiveAt = undefined;
		definition.purpose = undefined;
		return { turnedOff: true };
	};

	const deleteReadlistDefinition: DeleteReadlistDefinition = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		return { deleted: readlistDefinitions.delete(readlistDefinitionKey(params.userId, params.slug)) };
	};

	const readlistFitOverrideKey = (params: { userId: UserId; readlist: ReadlistSlug; id: ReadlistFitOverrideId }) =>
		`${params.userId}:${params.readlist}/${params.id}`;

	const readlistFitOverridesOf = (params: { userId: UserId; readlist: ReadlistSlug }): ReadlistFitOverride[] =>
		[...readlistFitOverrides.values()]
			.filter((entry) => entry.userId === params.userId && entry.readlist === params.readlist)
			.map((entry) => entry.override)
			.sort((a, b) => a.id.localeCompare(b.id));

	const recordReadlistFitOverride: RecordReadlistFitOverride = async ({ userId, readlist, override }) => {
		const id = readlistFitOverrideId(override);
		readlistFitOverrides.set(readlistFitOverrideKey({ userId, readlist, id }), {
			userId,
			readlist,
			override: { id, ...override },
		});
		for (const beyond of readlistFitOverridesOf({ userId, readlist }).slice(READLIST_FIT_OVERRIDES_KEPT)) {
			readlistFitOverrides.delete(readlistFitOverrideKey({ userId, readlist, id: beyond.id }));
		}
		return id;
	};

	const listReadlistFitOverrides: ListReadlistFitOverrides = async (params) =>
		readlistFitOverridesOf(params).slice(0, READLIST_FIT_OVERRIDES_KEPT);

	const deleteReadlistFitOverride: DeleteReadlistFitOverride = async (params) => {
		readlistFitOverrides.delete(readlistFitOverrideKey(params));
	};

	const purgeReadlistFitOverrides: PurgeReadlistFitOverrides = async ({ userId, readlist }) => {
		for (const override of readlistFitOverridesOf({ userId, readlist })) {
			readlistFitOverrides.delete(readlistFitOverrideKey({ userId, readlist, id: override.id }));
		}
	};

	const deleteReadlistArticleByUrl: DeleteReadlistArticleByUrl = async ({ userId, readlist, url }) => {
		recordReadlistRemoval({ userId, readlist, url });
		return userArticles.delete(userArticleKey(userId, ArticleResourceUniqueId.parse(url).value, readlist));
	};

	const filingOf = (definition: {
		purpose?: string;
		filingMode?: "manual" | "smart";
		filingRuleRevision?: number;
		filingRuleEffectiveAt?: Date;
	}): { filing?: ReadlistFiling } => {
		if (definition.filingMode === undefined) return {};
		if (definition.filingMode === "manual") return { filing: { mode: "manual" } };
		assert(definition.filingRuleRevision !== undefined, "a smart readlist carries its rule revision");
		assert(definition.filingRuleEffectiveAt !== undefined, "a smart readlist carries its rule's effective instant");
		assert(definition.purpose !== undefined, "a smart readlist carries its purpose");
		return {
			filing: {
				mode: "smart",
				purpose: definition.purpose,
				revision: definition.filingRuleRevision,
				effectiveAt: definition.filingRuleEffectiveAt,
			},
		};
	};

	const listReadlistDefinitions: ListReadlistDefinitions = async (userId) =>
		[...readlistDefinitions.values()]
			.filter((definition) => definition.userId === userId)
			.map((definition) => ({
				slug: definition.slug,
				label: definition.label,
				createdAt: definition.createdAt,
				...(definition.starterCampaignId === undefined ? {} : { starterCampaignId: definition.starterCampaignId }),
				...(definition.pinnedAt === undefined ? {} : { pinnedAt: definition.pinnedAt }),
				...filingOf(definition),
			}))
			.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.slug.localeCompare(b.slug));

	const markArticleViewed: MarkArticleViewed = async ({ userId, url, at }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const ua = userArticles.get(userArticleKey(userId, articleResourceUniqueId.value));
		if (!ua) return;
		ua.viewedAt = at;
	};

	const markReadlistArticleViewed: MarkReadlistArticleViewed = async ({ userId, readlist, url, at }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const ua = userArticles.get(userArticleKey(userId, articleResourceUniqueId.value, readlist));
		if (!ua) return;
		ua.viewedAt = at;
	};

	const markSummaryToggled: MarkSummaryToggled = async ({ userId, url, state, at }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const ua = userArticles.get(userArticleKey(userId, articleResourceUniqueId.value));
		if (!ua) return;
		if (state === "open") ua.lastSummaryOpenedAt = at;
		else ua.lastSummaryClosedAt = at;
	};

	const markRelatedDismissed: MarkRelatedDismissed = async ({
		userId,
		url,
		at,
		suggestionId,
	}) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const ua = userArticles.get(userArticleKey(userId, articleResourceUniqueId.value));
		if (!ua) return;
		ua.relatedDismissedAt = at;
		ua.relatedDismissedSuggestionId = suggestionId;
	};

	const markOcrPagesHeld: MarkOcrPagesHeld = async ({ userId, url, hold }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const ua = userArticles.get(userArticleKey(userId, articleResourceUniqueId.value));
		if (!ua) return;
		ua.ocrPagesHold = hold;
	};

	const markReaderReadyEmailSent: MarkReaderReadyEmailSent = async ({ userId, url, at }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const ua = userArticles.get(userArticleKey(userId, articleResourceUniqueId.value));
		if (!ua) return;
		if (ua.emailSentAt === undefined) ua.emailSentAt = at;
	};

	const getSummaryToggleState = async ({ userId, url }: { userId: UserId; url: string }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const ua = userArticles.get(userArticleKey(userId, articleResourceUniqueId.value));
		if (!ua) return null;
		return {
			lastSummaryOpenedAt: ua.lastSummaryOpenedAt,
			lastSummaryClosedAt: ua.lastSummaryClosedAt,
		};
	};

	const findUnreadSavesForDigest: FindUnreadSavesForDigest = async ({
		userId,
		savedAtOrBefore,
		emailFilter,
		limit,
		cursor,
	}) => {
		const passesEmailFilter = (ua: UserArticle): boolean =>
			emailFilter.kind === "any" ||
			ua.emailSentAt === undefined ||
			ua.emailSentAt.getTime() === emailFilter.sendInstant.getTime();
		const matching = [...userArticles.values()]
			.filter(
				(ua) =>
					ua.userId === userId &&
					ua.readlist === undefined &&
					ua.status === "unread" &&
					ua.provenance?.kind !== "hn-suggestion" &&
					ua.provenance?.kind !== "founder-seed" &&
					ua.savedAt.getTime() <= savedAtOrBefore.getTime() &&
					passesEmailFilter(ua),
			)
			.sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime());
		const start = cursor === undefined ? 0 : Number(cursor);
		const end = start + limit;
		return {
			candidates: matching.slice(start, end).map((ua) => {
				const article = articles.get(ua.url);
				assert(article, "every saved row has a global article");
				return {
					article: toSavedArticle(article, ua),
					emailSentAt: ua.emailSentAt,
					readerAvailableAt: article.readerAvailableAt,
					purgedAt: article.purgedAt,
				};
			}),
			nextCursor: end < matching.length ? DigestPageCursorSchema.parse(String(end)) : undefined,
		};
	};

	const findArticleFreshness: FindArticleFreshness = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const article = articles.get(articleResourceUniqueId.value);
		if (!article) return null;
		return {
			etag: article.etag,
			lastModified: article.lastModified,
			contentFetchedAt: article.contentFetchedAt,
			bodyHash: article.bodyHash,
		};
	};

	const findArticleCrawlVersions: FindArticleCrawlVersions = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const article = articles.get(articleResourceUniqueId.value);
		return (article?.crawlVersions ?? []).map((version) => ({ ...version }));
	};

	const readContent: ContentProvider = async (articleResourceUniqueId) => {
		const article = articles.get(articleResourceUniqueId.value);
		if (!article) return undefined;
		return article.content;
	};

	const findItemOwner: FindItemOwner = async (url) => articles.get(ArticleResourceUniqueId.parse(url).value)?.ownerUserId;

	const recordItemOwner = async (params: { url: string; ownerUserId: UserId }) => {
		const article = articles.get(ArticleResourceUniqueId.parse(params.url).value);
		assert(article, `Article not found for URL: ${params.url}`);
		article.ownerUserId = params.ownerUserId;
	};

	const savePrivateItem: SavePrivateItem = async (params) => {
		const key = ArticleResourceUniqueId.parse(params.url).value;
		const existing = articles.get(key);
		if (existing) {
			assert(existing.ownerUserId === params.ownerUserId, "a private item identity is saved by its uploader only");
			return "already-saved";
		}
		const manifest = MEDIA_KINDS.get(params.media.kind);
		assert(manifest, `no media kind manifest for ${params.media.kind}`);
		const routeId = ReaderArticleHashId.from(params.url);
		articles.set(key, {
			url: key,
			originalUrl: params.url,
			routeId,
			metadata: {
				title: params.media.fileName,
				siteName: manifest.label,
				excerpt: "",
				wordCount: 0,
			},
			estimatedReadTime: MinutesSchema.parse(0),
			savedAt: params.savedAt,
			ownerUserId: params.ownerUserId,
			media: { kind: params.media.kind, fileName: params.media.fileName, routeId },
		});
		userArticles.set(userArticleKey(params.ownerUserId, key), {
			userId: params.ownerUserId,
			url: key,
			status: "unread",
			savedAt: params.savedAt,
			provenance: { kind: "upload" },
			handPickedAt: params.savedAt,
			personalPickedAt: params.savedAt,
			personalDecision: `${params.savedAt.toISOString()}#${routeId.value}`,
			personalScope: "picked",
		});
		return "saved";
	};

	const recordPrivateItemFailure: RecordPrivateItemFailure = async (params) => {
		const article = articles.get(ArticleResourceUniqueId.parse(params.url).value);
		if (article?.ownerUserId === undefined) return "not-found";
		article.processingNotice = params.notice;
		return "recorded";
	};

	const recordPrivateItemSections: RecordPrivateItemSections = async (params) => {
		const article = articles.get(ArticleResourceUniqueId.parse(params.url).value);
		if (article?.ownerUserId === undefined || article.purgedAt !== undefined || article.media === undefined) {
			return "not-found";
		}
		article.media = { ...article.media, sectionCount: params.sectionCount };
		return "recorded";
	};

	const recordTranscriptOutcome: RecordTranscriptOutcome = async (params) => {
		const article = articles.get(ArticleResourceUniqueId.parse(params.url).value);
		if (article?.ownerUserId === undefined || article.purgedAt !== undefined || article.media === undefined) {
			return "not-found";
		}
		article.media = { ...article.media, transcript: params.transcript };
		return "recorded";
	};

	const setArticleEnclosure: SetArticleEnclosure = async (params) => {
		const article = articles.get(ArticleResourceUniqueId.parse(params.url).value);
		if (article?.ownerUserId === undefined || article.purgedAt !== undefined) return "not-found";
		article.enclosure = params.enclosure;
		return "recorded";
	};

	const writeContent = async (params: { url: string; content: string }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const article = articles.get(articleResourceUniqueId.value);
		assert(article, `Article not found for URL: ${articleResourceUniqueId.value}`);
		article.content = params.content;
	};

	const readArticleImage: ReadArticleImage = async ({ url, filename }) => {
		const key = ArticleResourceUniqueId.parse(url).toS3ImageKey(filename);
		const image = articleImages.get(key);
		if (!image) return undefined;
		return image.body;
	};

	const writeImage = async (params: {
		url: string;
		filename: string;
		body: Buffer;
		contentType: string;
	}) => {
		const key = ArticleResourceUniqueId.parse(params.url).toS3ImageKey(params.filename);
		articleImages.set(key, { body: params.body, contentType: params.contentType });
	};

	const writeMetadata = async (params: { url: string; metadata: ArticleMetadata; estimatedReadTime: Minutes }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const article = articles.get(articleResourceUniqueId.value);
		assert(article, `Article not found for URL: ${articleResourceUniqueId.value}`);
		article.metadata = params.metadata;
		article.estimatedReadTime = params.estimatedReadTime;
	};

	const setContentSourceTier = async (params: { url: string; tier: "tier-0" | "tier-1" | "tier-2" }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const article = articles.get(articleResourceUniqueId.value);
		assert(article, `Article not found for URL: ${articleResourceUniqueId.value}`);
		article.contentSourceTier = params.tier;
	};

	const setContentFetchedAt = async (params: { url: string; at: string }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const article = articles.get(articleResourceUniqueId.value);
		assert(article, `Article not found for URL: ${articleResourceUniqueId.value}`);
		article.contentFetchedAt = params.at;
	};

	const setCanonicalContentHash = async (params: { url: string; canonicalContentHash: string }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const article = articles.get(articleResourceUniqueId.value);
		assert(article, `Article not found for URL: ${articleResourceUniqueId.value}`);
		article.canonicalContentHash = params.canonicalContentHash;
	};

	const readCanonicalSnapshot: ReadCanonicalSnapshot = async (url) => {
		const article = articles.get(ArticleResourceUniqueId.parse(url).value);
		if (article?.canonicalContentHash === undefined) return undefined;
		return {
			canonicalContentHash: article.canonicalContentHash,
			...(article.canonicalCandidateId === undefined ? {} : { canonicalCandidateId: article.canonicalCandidateId }),
		};
	};

	const replaceCanonicalContent = async (params: {
		url: string;
		content: string;
		canonicalContentHash: string;
		canonicalCandidateId: CandidateId;
	}) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const article = articles.get(articleResourceUniqueId.value);
		assert(article, `Article not found for URL: ${articleResourceUniqueId.value}`);
		article.content = params.content;
		article.canonicalContentHash = params.canonicalContentHash;
		article.canonicalCandidateId = params.canonicalCandidateId;
	};

	const setCrawlVersions = async (params: { url: string; versions: ArticleCrawlVersion[] }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const article = articles.get(articleResourceUniqueId.value);
		assert(article, `Article not found for URL: ${articleResourceUniqueId.value}`);
		article.crawlVersions = params.versions;
	};

	const setDisplayUrl = async (params: { url: string; displayUrl: string }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const article = articles.get(articleResourceUniqueId.value);
		assert(article, `Article not found for URL: ${articleResourceUniqueId.value}`);
		article.displayUrl = params.displayUrl;
	};

	const aliases = new Map<string, { targetUrl: string; createdAt: Date; sourceBinding?: WrapperSourceBinding }>();

	const claimAlias: ClaimCanonicalAlias = async (params) => {
		const key = ArticleResourceUniqueId.parse(params.aliasUrl).value;
		if (articles.has(key)) return;
		const existing = aliases.get(key);
		if (existing !== undefined && (params.sourceBinding === undefined || existing.targetUrl !== params.targetOriginalUrl)) return;
		aliases.set(key, { targetUrl: params.targetOriginalUrl, createdAt: params.now, sourceBinding: params.sourceBinding });
	};

	const resolveAlias = async (url: string) => {
		return aliases.get(ArticleResourceUniqueId.parse(url).value)?.targetUrl;
	};

	const findIdentityRow: FindIdentityRow = async (url) => {
		const key = ArticleResourceUniqueId.parse(url).value;
		const article = articles.get(key);
		if (article) return {
			kind: "article",
			originalUrl: article.purgedAt === undefined ? article.displayUrl ?? article.originalUrl : article.displayUrl,
			sourceBinding: article.contentSourceUrl !== undefined && article.sourceOriginalUrl !== undefined
				? { contentSourceUrl: article.contentSourceUrl, sourceOriginalUrl: article.sourceOriginalUrl }
				: undefined,
		};
		const alias = aliases.get(key);
		if (alias) return { kind: "alias", targetUrl: alias.targetUrl, sourceBinding: alias.sourceBinding };
		return { kind: "absent" } as const;
	};

	const pinContentSource: PinContentSource = async (params) => {
		const article = articles.get(ArticleResourceUniqueId.parse(params.articleUrl).value);
		assert(article && (article.displayUrl ?? article.originalUrl) === params.sourceOriginalUrl, "Content source identity changed");
		article.contentSourceUrl = params.contentSourceUrl;
		article.sourceOriginalUrl = params.sourceOriginalUrl;
	};

	const findAdoptedFetchUrl = async (url: string) => {
		const article = articles.get(ArticleResourceUniqueId.parse(url).value);
		return article?.displayUrl;
	};

	const findContentSourceUrl = async (url: string) =>
		articles.get(ArticleResourceUniqueId.parse(url).value)?.contentSourceUrl;

	const setPurgedAt = async (params: { url: string; at: Date }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const article = articles.get(articleResourceUniqueId.value);
		assert(article, `Article not found for URL: ${articleResourceUniqueId.value}`);
		article.purgedAt = params.at;
	};

	const setReaderAvailableAt = async (params: { url: string; at: Date }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const article = articles.get(articleResourceUniqueId.value);
		assert(article, `Article not found for URL: ${articleResourceUniqueId.value}`);
		article.readerAvailableAt = params.at;
	};

	return {
		findPersonalLibrary,
		saveStarterPack,
		changePersonalPick,
		saveArticle,
		saveArticleKeepingPosition,
		seedUncertainSave: ({ userId, url }) => {
			const row = userArticles.get(userArticleKey(userId, ArticleResourceUniqueId.parse(url).value));
			assert(row && !row.personalDecision, "only an existing unclassified save can enter older-saves review");
			row.personalScope = "uncertain";
			row.unknownOrigin = true;
		},
		readHandPickedAt,
		readNewsletterLinkRows,
		allocateSavedAt,
		allocateSavedAtSequence,
		findSavedUrls,
		saveArticleGlobally,
		findArticleById,
		findArticleByUrl,
		findArticleUrlById,
		findArticleFreshness,
		findArticleCrawlVersions,
		findArticlesByUser,
		findArticlesAcrossReadlists,
		countArticlesByUser,
		deleteArticle,
		holdBulkArticle,
		markReadEverywhereForBulk,
		onDefaultRowDeleted: (listener) => {
			defaultRowDeletedListeners.push(listener);
		},
		readSavedRowRelatedRequest,
		stampRelatedPassesRequested,
		deleteAllUserArticles,
		listUserArticleUrls,
		findOriginalUrls,
		findUnrestorableArticles,
		findKeysInAll,
		moveNewsletterLinkToHold,
		restoreHeldLink,
		forEachHeldLinkPage,
		hasHeldLinks,
		findHeldLink,
		requestSavedLinksJob,
		recordSavedLinksJobProgress,
		recordCountedNewsletterLinks,
		finishSavedLinksJob,
		findSavedLinksJob,
		withdrawSavedLinksJob,
		updateArticleStatus,
		markArticleViewed,
		markSummaryToggled,
		markRelatedDismissed,
		markOcrPagesHeld,
		markReaderReadyEmailSent,
		findUnreadSavesForDigest,
		saveReadlistArticle,
		saveArticleAsRequested,
		saveReadlistArticleAsRequested,
		findReadlistArticles,
		countReadlistArticles,
		findReadlistArticleById,
		updateArticleStatusAcrossReadlists,
		deleteReadlistArticle,
		purgeReadlistArticle,
		findReadlistFiling,
		findReadlistRemoval,
		findSmartMatchRevisions,
		recordSmartMatchRevision,
		fileIntoLiveReadlist,
		markReadlistArticleViewed,
		listUserSavesForUrl,
		findQueueRowKeys,
		hasQueueRow,
		countSmartReadlistArticles,
		listUserSavesForUrls,
		assignSavedArticleToReadlist,
		moveReadlistArticles,
		createReadlistDefinition,
		deleteReadlistDefinition,
		recordReadlistFitOverride,
		listReadlistFitOverrides,
		deleteReadlistFitOverride,
		purgeReadlistFitOverrides,
		deleteReadlistArticleByUrl,
		listReadlistDefinitions,
		renameReadlistDefinition,
		pinReadlistDefinition,
		unpinReadlistDefinition,
		setSmartReadlistRule,
		turnOffSmartReadlistMatching,
		getSummaryToggleState,
		readContent,
		findItemOwner,
		recordItemOwner,
		savePrivateItem,
		recordPrivateItemFailure,
		recordPrivateItemSections,
		recordTranscriptOutcome,
		setArticleEnclosure,
		writeContent,
		readArticleImage,
		writeImage,
		writeMetadata,
		setContentSourceTier,
		setContentFetchedAt,
		setCanonicalContentHash,
		readCanonicalSnapshot,
		replaceCanonicalContent,
		setDisplayUrl,
		claimAlias,
		resolveAlias,
		findIdentityRow,
		pinContentSource,
		findAdoptedFetchUrl,
		findContentSourceUrl,
		setCrawlVersions,
		setPurgedAt,
		setReaderAvailableAt,
		setReadlistArticleStatus,
	};
}
