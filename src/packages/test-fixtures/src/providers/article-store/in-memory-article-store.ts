import type { MarkRelatedPassesRequestedOutcome } from "@packages/provider-contracts/related-articles";
import assert from "node:assert";
import { createHash } from "node:crypto";
import type {
	ArticleDiscoveryQuery,
	ArticleMetadata,
	ArticleStatus,
	ItemMedia,
	Minutes,
	SaveProvenance,
	SavedArticle,
	ServedBody,
} from "@packages/domain/article";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	ReaderArticleHashId,
	articleDestinationUrl,
	ANONYMOUS_VIEWER,
	MinutesSchema,
	articleDisplayMetadata,
	discoveryCandidateOf,
	matchesArticleDiscovery,
	viewerFor,
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
import { type EmailDeliveryMode, LEGACY_DELIVERY_MODE } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type {
	AllocateSavedAt,
	AllocateSavedAtSequence,
	AssignSavedArticleToReadlist,
	MoveReadlistArticles,
	FindSavedUrls,
	ArticleCrawlVersion,
	BumpArticleSavedAt,
	ClearReadlistDefinitionPurpose,
	CountArticlesByUser,
	CountReadlistArticles,
	CreateReadlistDefinition,
	DeleteReadlistDefinition,
	DeleteReadlistFitOverride,
	DeleteReadlistArticleByUrl,
	DeleteAllUserArticles,
	DeleteArticle,
	DeleteReadlistArticle,
	ListReadlistDefinitions,
	ListReadlistFitOverrides,
	PurgeReadlistFitOverrides,
	ReadlistFitOverride,
	RecordReadlistFitOverride,
	RenameReadlistDefinition,
	SetReadlistDefinitionEmailDelivery,
	SetReadlistDefinitionPurpose,
	ListUserArticleUrls,
	ListUserSavesForUrl,
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
	FindUserArticlesByUrl,
	MarkArticleViewed,
	MarkReadlistArticleViewed,
	MarkReaderReadyEmailSent,
	MarkRelatedDismissed,
	MarkSummaryToggled,
	ContentProvider,
	FindItemOwner,
	ReadArticleImage,
	RecordPrivateItemFailure,
	RecordPrivateItemSections,
	SaveArticle,
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
import { DigestPageCursorSchema } from "@packages/provider-contracts/article-store";
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
	contentSourceTier?: "tier-0" | "tier-1" | "tier-2";
	crawlVersions?: ArticleCrawlVersion[];
	purgedAt?: Date;
	readerAvailableAt?: Date;
	ownerUserId?: UserId;
	media?: ItemMedia;
	processingNotice?: string;
}

interface UserArticle {
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
	relatedDismissedAt?: Date;
	relatedDismissedSuggestionId?: ReaderArticleHashId;
	relatedPassesRequestedAt?: Date;
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
		savedAt: userArticle.savedAt,
		readAt: userArticle.readAt,
		viewedAt: userArticle.viewedAt,
		contentFetchedAt: article.contentFetchedAt === undefined ? undefined : new Date(article.contentFetchedAt),
		provenance: userArticle.provenance,
		suggestionAttribution: userArticle.suggestionAttribution,
		relatedDismissedAt: userArticle.relatedDismissedAt,
		relatedDismissedSuggestionId: userArticle.relatedDismissedSuggestionId,
		media: article.media,
		processingNotice: article.processingNotice,
	};
}

export function initInMemoryArticleStore(): {
	findPersonalLibrary: FindPersonalLibrary;
	saveStarterPack: SaveStarterPack;
	saveArticle: SaveArticle;
	saveArticleKeepingPosition: SaveArticle;
	allocateSavedAt: AllocateSavedAt;
	allocateSavedAtSequence: AllocateSavedAtSequence;
	findSavedUrls: FindSavedUrls;
	saveArticleGlobally: SaveArticleGlobally;
	bumpArticleSavedAt: BumpArticleSavedAt;
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
	findUserArticlesByUrl: FindUserArticlesByUrl;
	markReaderReadyEmailSent: MarkReaderReadyEmailSent;
	findUnreadSavesForDigest: FindUnreadSavesForDigest;
	saveReadlistArticle: SaveReadlistArticle;
	findReadlistArticles: FindReadlistArticles;
	countReadlistArticles: CountReadlistArticles;
	findReadlistArticleById: FindReadlistArticleById;
	updateArticleStatusAcrossReadlists: UpdateArticleStatusAcrossReadlists;
	deleteReadlistArticle: DeleteReadlistArticle;
	markReadlistArticleViewed: MarkReadlistArticleViewed;
	listUserSavesForUrl: ListUserSavesForUrl;
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
	setReadlistDefinitionPurpose: SetReadlistDefinitionPurpose;
	setReadlistDefinitionEmailDelivery: SetReadlistDefinitionEmailDelivery;
	clearReadlistDefinitionPurpose: ClearReadlistDefinitionPurpose;
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
	const defaultRowDeletedListeners: ((row: { userId: UserId; url: string }) => void)[] = [];
	const announceDefaultRowDeleted = (row: { userId: UserId; url: string }) => {
		for (const listener of defaultRowDeletedListeners) listener(row);
	};
	const saveCursors = new Map<UserId, number>();
	const readlistDefinitions = new Map<
		string,
		{
			userId: UserId;
			slug: ReadlistSlug;
			label: string;
			purpose?: string;
			emailDelivery: EmailDeliveryMode;
			createdAt: Date;
			starterCampaignId?: string;
		}
	>();
	const readlistFitOverrides = new Map<
		string,
		{ userId: UserId; readlist: ReadlistSlug; override: ReadlistFitOverride }
	>();
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
			emailDelivery: LEGACY_DELIVERY_MODE,
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
		const routeId = ReaderArticleHashId.from(params.url);
		articles.set(articleResourceUniqueId.value, {
			url: articleResourceUniqueId.value,
			originalUrl: params.url,
			displayUrl: existing?.displayUrl,
			routeId,
			metadata: params.metadata,
			estimatedReadTime: params.estimatedReadTime,
			savedAt: params.savedAt,
		});
		return { created: true };
	};

	const bumpArticleSavedAt: BumpArticleSavedAt = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const article = articles.get(articleResourceUniqueId.value);
		if (!article) return;
		article.savedAt = params.savedAt;
	};

	const saveInto = async (readlist: ReadlistSlug | undefined, params: SaveArticleParams) => {
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
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);

		const uaKey = userArticleKey(params.userId, articleResourceUniqueId.value, readlist);
		const existing = userArticles.get(uaKey);
		const newerSaveWon = existing !== undefined && existing.savedAt.getTime() >= params.savedAt.getTime();
		if (!newerSaveWon) {
			userArticles.set(uaKey, existing
				? {
					...existing,
					savedAt: params.savedAt,
					provenance: params.provenance,
					suggestionAttribution: existing.suggestionAttribution ?? params.suggestionAttribution,
				}
				: {
					userId: params.userId,
					readlist,
					url: articleResourceUniqueId.value,
					status: "unread",
					savedAt: params.savedAt,
					provenance: params.provenance,
					suggestionAttribution: params.suggestionAttribution,
				});
		}

		const article = articles.get(articleResourceUniqueId.value);
		assert(article, "Article must exist after set");
		const ua = userArticles.get(uaKey);
		assert(ua, "User article must exist after set");
		return {
			saved: toSavedArticle(article, ua),
			createdUserArticle: existing === undefined,
			wroteUserArticle: !newerSaveWon,
		};
	};

	const saveArticle: SaveArticle = (params) => saveInto(undefined, params);

	const saveReadlistArticle: SaveReadlistArticle = ({ readlist, ...params }) => saveInto(readlist, params);

	const saveArticleKeepingPosition: SaveArticle = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const existing = userArticles.get(userArticleKey(params.userId, articleResourceUniqueId.value));
		if (existing === undefined) return saveArticle(params);

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
		return { saved: toSavedArticle(article, existing), createdUserArticle: false, wroteUserArticle: false };
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

	const listPartition = async (
		readlist: ReadlistSlug | undefined,
		query: FindArticlesQuery,
	): Promise<FindArticlesResult> => {
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;
		const order = query.order ?? "desc";
		const sort = query.sort ?? "savedAt";

		let userArts = Array.from(userArticles.values()).filter(
			(ua) => ua.userId === query.userId && ua.readlist === readlist,
		);

		if (query.status) {
			userArts = userArts.filter((ua) => ua.status === query.status);
		}

		userArts.sort((a, b) => {
			const aValue = sort === "readAt" ? a.readAt : a.savedAt;
			const bValue = sort === "readAt" ? b.readAt : b.savedAt;
			assert(aValue, "sort field must be set on every row matching this query");
			assert(bValue, "sort field must be set on every row matching this query");
			const diff = aValue.getTime() - bValue.getTime();
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
		query: { userId: UserId; status?: ArticleStatus; countLimit?: number; discovery?: ArticleDiscoveryQuery },
	): number => {
		let userArts = Array.from(userArticles.values()).filter(
			(ua) => ua.userId === query.userId && ua.readlist === readlist,
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
		if (readlist === undefined) announceDefaultRowDeleted({ userId, url: article.originalUrl });
		return true;
	};

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

	const deleteReadlistArticle: DeleteReadlistArticle = async ({ id, userId, readlist }) =>
		deleteFrom(readlist, id, userId);

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
		saveCursors.delete(userId);
	};

	const listUserArticleUrls: ListUserArticleUrls = async (userId) => {
		const urls = new Set<string>();
		for (const ua of userArticles.values()) {
			if (ua.userId !== userId) continue;
			const article = articles.get(ua.url);
			if (article) urls.add(article.originalUrl);
		}
		return [...urls];
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
		const { relatedPassesRequestedAt: _assignedAcknowledgement, ...assigned } = source;
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

	const listUserSavesForUrls: ListUserSavesForUrls = async ({ userId, urls, readlists }) => {
		const saves = new Map<string, { readlist?: ReadlistSlug }[]>();
		for (const url of urls) {
			const memberships = await listUserSavesForUrl({ userId, url });
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
	): SavedArticle | null => {
		const article = findArticleByRouteId(id);
		if (!article) return null;

		const uaKey = userArticleKey(userId, article.url, readlist);
		const ua = userArticles.get(uaKey);
		if (!ua) return null;

		ua.status = status;
		if (status === "read") {
			ua.readAt = ua.readAt ?? readAt;
		} else {
			ua.readAt = undefined;
		}
		userArticles.set(uaKey, ua);
		return toSavedArticle(article, ua);
	};

	const updateArticleStatus: UpdateArticleStatus = async (id, userId, status) =>
		updateStatusIn(undefined, id, userId, status, new Date());

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
			emailDelivery: LEGACY_DELIVERY_MODE,
			createdAt: params.createdAt,
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

	const setReadlistDefinitionPurpose: SetReadlistDefinitionPurpose = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const definition = readlistDefinitions.get(readlistDefinitionKey(params.userId, params.slug));
		if (!definition) return { updated: false };
		definition.purpose = params.purpose;
		return { updated: true };
	};

	const setReadlistDefinitionEmailDelivery: SetReadlistDefinitionEmailDelivery = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const definition = readlistDefinitions.get(readlistDefinitionKey(params.userId, params.slug));
		if (!definition) return { updated: false };
		definition.emailDelivery = params.emailDelivery;
		return { updated: true };
	};

	const clearReadlistDefinitionPurpose: ClearReadlistDefinitionPurpose = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const definition = readlistDefinitions.get(readlistDefinitionKey(params.userId, params.slug));
		if (!definition) return { cleared: false };
		definition.purpose = undefined;
		return { cleared: true };
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

	const deleteReadlistArticleByUrl: DeleteReadlistArticleByUrl = async ({ userId, readlist, url }) =>
		userArticles.delete(userArticleKey(userId, ArticleResourceUniqueId.parse(url).value, readlist));

	const listReadlistDefinitions: ListReadlistDefinitions = async (userId) =>
		[...readlistDefinitions.values()]
			.filter((definition) => definition.userId === userId)
			.map(({ slug, label, purpose, emailDelivery, createdAt, starterCampaignId }) => ({
				slug,
				label,
				purpose,
				emailDelivery,
				createdAt,
				...(starterCampaignId === undefined ? {} : { starterCampaignId }),
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

	const findUserArticlesByUrl: FindUserArticlesByUrl = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const result: { userId: UserId; viewedAt?: Date }[] = [];
		for (const ua of userArticles.values()) {
			if (ua.url === articleResourceUniqueId.value && ua.readlist === undefined) {
				result.push({ userId: ua.userId, viewedAt: ua.viewedAt });
			}
		}
		return result;
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
		const routeId = ReaderArticleHashId.from(params.url);
		articles.set(key, {
			url: key,
			originalUrl: params.url,
			routeId,
			metadata: { title: params.media.fileName, siteName: "Book", excerpt: "", wordCount: 0 },
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
		saveArticle,
		saveArticleKeepingPosition,
		allocateSavedAt,
		allocateSavedAtSequence,
		findSavedUrls,
		saveArticleGlobally,
		bumpArticleSavedAt,
		findArticleById,
		findArticleByUrl,
		findArticleUrlById,
		findArticleFreshness,
		findArticleCrawlVersions,
		findArticlesByUser,
		findArticlesAcrossReadlists,
		countArticlesByUser,
		deleteArticle,
		onDefaultRowDeleted: (listener) => {
			defaultRowDeletedListeners.push(listener);
		},
		readSavedRowRelatedRequest,
		stampRelatedPassesRequested,
		deleteAllUserArticles,
		listUserArticleUrls,
		updateArticleStatus,
		markArticleViewed,
		markSummaryToggled,
		markRelatedDismissed,
		findUserArticlesByUrl,
		markReaderReadyEmailSent,
		findUnreadSavesForDigest,
		saveReadlistArticle,
		findReadlistArticles,
		countReadlistArticles,
		findReadlistArticleById,
		updateArticleStatusAcrossReadlists,
		deleteReadlistArticle,
		markReadlistArticleViewed,
		listUserSavesForUrl,
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
		setReadlistDefinitionPurpose,
		setReadlistDefinitionEmailDelivery,
		clearReadlistDefinitionPurpose,
		getSummaryToggleState,
		readContent,
		findItemOwner,
		recordItemOwner,
		savePrivateItem,
		recordPrivateItemFailure,
		recordPrivateItemSections,
		writeContent,
		readArticleImage,
		writeImage,
		writeMetadata,
		setContentSourceTier,
		setContentFetchedAt,
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
