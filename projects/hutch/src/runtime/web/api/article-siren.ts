import assert from "node:assert";
import Handlebars from "handlebars";
import { parseCrawlFailureReason } from "@packages/article-state-types";
import {
	ABSENT_ENCLOSURE,
	type CrawlRemainingEstimate,
	type DisplayableReadTime,
	type EnclosureRead,
	isPrivateItemUrl,
	type SavedArticle,
} from "@packages/domain/article";
import { displayableTime } from "../shared/displayable-time";
import { DEFAULT_READLIST_SLUG, READLIST_MAX_PER_USER } from "@packages/domain/readlist";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { MAX_POLLS, POLL_INTERVAL_SECONDS } from "@packages/web-shell";
import { computeArticleContentVersion } from "../shared/article-content-version";
import type { SirenEntity, SirenLink, SirenMessage, SirenSubEntity } from "./siren";
import { type CollectionQueryParams, type ReadlistQueryKey, buildQueryString } from "./collection-query";
import type { ReadlistOption } from "./readlist-list";
import { readlistHref } from "./readlist-href";
import type { AddToReadlistOffer } from "../pages/readlist/add-to-readlist-offer";
import { cardKindOf } from "../pages/readlist/readlist-card/card-kind-label";
import { type CardPhase, cardProcessingOf } from "../pages/readlist/readlist-card/card-processing";
import type { ContentState } from "../pages/readlist/readlist-card/content-state";
import { staleNoticeHtml } from "../pages/readlist/readlist-card/stale-notice";

export type ArticleEntityProperties = {
	id: string;
	url: string;
	title: string;
	siteName: string;
	excerpt: string;
	imageUrl: string | null;
	readTime: DisplayableReadTime | null;
	sectionCount?: number;
	status: SavedArticle["status"];
	savedAt: string;
	publishedOn: string | null;
	readAt: string | null;
	isRead: boolean;
	needsBrowserCapture: boolean;
	contentState: ContentState;
	contentVersion: string;
	mediaKind: NonNullable<SavedArticle["media"]>["kind"] | null;
	durationSeconds: number | null;
	processing?: {
		label: string;
		estimate?: CrawlRemainingEstimate;
		refresh: { href: string; afterSeconds: number };
	};
	messages?: SirenMessage[];
};

function needsBrowserCapture(crawl: ArticleCrawl | undefined): boolean {
	if (crawl?.status !== "failed") return false;
	const reason = parseCrawlFailureReason(crawl.reason);
	if (reason?.kind !== "blocked") return false;
	return reason.cause === "edge-block" || reason.cause === "rate-limited";
}

function itemMessages(params: { article: SavedArticle; phase: CardPhase }): SirenMessage[] {
	const { article, phase } = params;
	const stale: SirenMessage[] =
		phase.kind === "stale"
			? [
					{
						type: "warning",
						content: {
							type: "text/html",
							body: staleNoticeHtml({
								url: article.destinationUrl,
								siteName: article.metadata.siteName,
								hasOrigin: !isPrivateItemUrl(article.url),
								kindNoun: cardKindOf(article)?.kind.noun,
							}),
						},
					},
				]
			: [];
	const upload: SirenMessage[] =
		article.processingNotice === undefined
			? []
			: [
					{
						type: "warning",
						content: { type: "text/html", body: Handlebars.Utils.escapeExpression(article.processingNotice) },
					},
				];
	return [...stale, ...upload];
}

export function toArticleSubEntity(
	article: SavedArticle,
	options: {
		addToReadlist: AddToReadlistOffer;
		crawl?: ArticleCrawl;
		summary?: GeneratedSummary;
		collectionQuery?: CollectionQueryParams;
		now: Date;
		pollCount?: number;
		enclosure?: EnclosureRead;
	},
): SirenSubEntity {
	const id = article.id.value;
	const links: SirenLink[] = [
		{ rel: ["read"], title: "Read", href: `/queue/${id}/view${options.collectionQuery ? buildQueryString({ readlistKey: options.collectionQuery.readlistKey, readlist: options.collectionQuery.readlist }) : ""}` },
	];

	const isRead = article.status === "read";
	const targetStatus = isRead ? "unread" : "read";
	const enclosure = options.enclosure ?? ABSENT_ENCLOSURE;
	const readTime = displayableTime({ article, enclosure });
	const hrefQuery = options.collectionQuery ? buildQueryString(options.collectionQuery) : "";
	const ownReadlist = options.collectionQuery?.readlist === DEFAULT_READLIST_SLUG ? undefined : options.collectionQuery?.readlist;
	const { label, phase, contentState } = cardProcessingOf({
		article,
		crawl: options.crawl,
		summary: options.summary,
		now: options.now,
		pollCount: options.pollCount ?? 1,
		maxPolls: MAX_POLLS,
	});
	const messages = itemMessages({ article, phase });
	const properties: ArticleEntityProperties = {
		id,
		// Display: the redirect destination when this article was merged onto one,
		// else the saved URL. Navigation/mutation use `id`, so this is safe.
		url: article.destinationUrl,
		title: article.metadata.title,
		siteName: article.metadata.siteName,
		excerpt: article.metadata.excerpt,
		imageUrl: article.metadata.imageUrl ?? null,
		readTime: readTime ?? null,
		...(article.media?.sectionCount === undefined ? {} : { sectionCount: article.media.sectionCount }),
		status: article.status,
		savedAt: article.savedAt.toISOString(),
		publishedOn: article.metadata.publishedOn ?? null,
		readAt: article.readAt?.toISOString() ?? null,
		// An explicit presentational read-state so a client renders the read
		// indicator from one server-authored boolean rather than re-deriving it
		// from the `status` vocabulary it would otherwise have to hard-code.
		isRead,
		needsBrowserCapture: needsBrowserCapture(options.crawl),
		contentState,
		contentVersion: computeArticleContentVersion({
			article,
			crawl: options.crawl,
			summary: options.summary,
		}),
		mediaKind: article.media?.kind ?? null,
		durationSeconds: enclosure.kind === "owned" ? enclosure.enclosure.durationSeconds : null,
		...(phase.kind === "processing"
			? {
					processing: {
						label,
						...(phase.estimate === undefined ? {} : { estimate: phase.estimate }),
						refresh: {
							href: `/queue/${id}/card${hrefQuery}${hrefQuery === "" ? "?" : "&"}poll=${phase.pollCursor}`,
							afterSeconds: POLL_INTERVAL_SECONDS,
						},
					},
				}
			: {}),
		...(messages.length === 0 ? {} : { messages }),
	};

	return {
		class: ["article"],
		rel: ["item"],
		properties,
		links,
		actions: [
			{
				name: "update-status",
				title: isRead ? "Mark as unread" : "Mark as read",
				href: `/queue/${id}/status${hrefQuery}`,
				method: "POST",
				type: "application/x-www-form-urlencoded",
				fields: [{ name: "status", type: "text", value: targetStatus }],
			},
			...(options.addToReadlist === "withheld"
				? []
				: [
						{
							name: "add-to-readlist",
							href: `/queue/${id}/assign${hrefQuery}`,
							method: "POST",
							type: "application/json",
							fields: [{ name: "readlists", type: "text", maxItems: READLIST_MAX_PER_USER }],
						},
					]),
			...(ownReadlist === undefined
				? []
				: [
						{
							name: "remove-from-readlist",
							href: `/queue/${id}/unassign${hrefQuery}`,
							method: "POST",
							type: "application/x-www-form-urlencoded",
						},
					]),
		],
	};
}

export function toArticleEntity(article: SavedArticle, options: { now: Date }): SirenEntity {
	const { rel: _rel, ...entity } = toArticleSubEntity(article, { addToReadlist: "advertised", now: options.now });
	return entity;
}

export interface SaveDestination {
	filedInto: readonly ReadlistOption[];
	readlists: readonly ReadlistOption[];
}

function quotedLabels(readlists: readonly ReadlistOption[]): string {
	const quoted = readlists.map(
		(readlist) => `'${Handlebars.Utils.escapeExpression(readlist.label)}'`,
	);
	const last = quoted[quoted.length - 1];
	const preceding = quoted.slice(0, -1);
	return preceding.length === 0 ? last : `${preceding.join(", ")} and ${last}`;
}

function savedIntoBody(destination: SaveDestination): string {
	return destination.readlists.length > 1
		? `Saved to ${quotedLabels(destination.filedInto)}`
		: "Saved to your reading list";
}

/** The article a save just accepted, carrying what the client should tell the
 * reader and where it may send them next. The confirmation copy and the
 * onward affordance are server-authored so a client renders the outcome from
 * this response alone — it has no reason to fetch the collection, and none of
 * the wording lives in a shipped build. */
export function toSavedArticleEntity(params: {
	article: SavedArticle;
	createdUserArticle: boolean;
	wroteUserArticle: boolean;
	resurfacedFromRead: boolean;
	destination: SaveDestination;
	readlistKey: ReadlistQueryKey;
	now: Date;
}): SirenEntity {
	const [collectionReadlist] = params.destination.filedInto;
	assert(collectionReadlist, "a save always lands in at least one readlist");
	const entity = toArticleEntity(params.article, { now: params.now });
	const savedAfresh = params.createdUserArticle || params.resurfacedFromRead;
	const messages: SirenMessage[] = savedAfresh
		? [
				{ type: "success", content: { type: "text/html", body: "Article saved" } },
				{
					type: "success",
					content: { type: "text/html", body: savedIntoBody(params.destination) },
				},
			]
		: [{ type: "success", content: { type: "text/html", body: "Already saved" } }];
	if (!savedAfresh && params.wroteUserArticle) {
		messages.push({
			type: "success",
			content: { type: "text/html", body: "Bumped to the top of the list" },
		});
	}
	return {
		...entity,
		properties: { ...entity.properties, messages },
		links: [
			...(entity.links ?? []),
			{
				rel: ["collection"],
				title: "View Readlist",
				href: readlistHref({ readlist: collectionReadlist.slug, readlistKey: params.readlistKey }),
			},
		],
	};
}
