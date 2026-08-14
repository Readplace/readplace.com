import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArticleStatus, NextReadDismissal } from "@packages/domain/article";
import { decideNextReadSlot } from "@packages/domain/article";
import type {
	RelatedArticleDisplay,
	RelatedArticles,
} from "@packages/provider-contracts/related-articles";
import { render, toRelativePhrase, withInternalTracking } from "@packages/web-shell";
import type { LocalTime } from "@packages/web-shell/local-time.format";
import { NEXT_READ_TRACKING } from "./next-read.tracking";

const NEXT_READ_TEMPLATE = readFileSync(
	join(__dirname, "next-read.template.html"),
	"utf-8",
);

const READY_CLASS = "next-read--ready";
const HIDDEN_CLASS = "next-read--hidden";

const STATUS_COPY = {
	unread: {
		eyebrow: "Next read",
		statusLabel: "Unread",
		statusClass: "next-read__status--unread",
	},
	read: {
		eyebrow: "Similar past reads",
		statusLabel: "Read",
		statusClass: "next-read__status--read",
	},
} satisfies Record<
	ArticleStatus,
	{ eyebrow: string; statusLabel: string; statusClass: string }
>;

export const NEXT_READ_SCRIPT =
	'<script src="/client-dist/next-read.client.js" defer></script>';

export interface NextReadContext {
	articles: RelatedArticles;
	sourceArticleId: string;
	now: Date;
	dismissal: NextReadDismissal | undefined;
}

export interface NextReadInput {
	related?: NextReadContext;
	pollUrl?: string;
	returnTo: string;
}

interface DatedLine {
	lead: string;
	time: LocalTime;
}

interface NextReadCard {
	id: string;
	href: string;
	dismissUrl: string;
	returnTo: string;
	title: string;
	siteName: string;
	reason: string;
	eyebrow: string;
	readStatus: ArticleStatus;
	statusLabel: string;
	statusClass: string;
	dated: DatedLine;
}

function pickOf(input: {
	items: readonly RelatedArticleDisplay[];
	dismissal: NextReadDismissal | undefined;
	now: Date;
}): RelatedArticleDisplay | undefined {
	const slot = decideNextReadSlot({
		dismissal: input.dismissal,
		related: input.items,
		now: input.now,
	});
	if (slot === "suppress") return undefined;
	return input.items.find((item) => item.status === "unread") ?? input.items[0];
}

function datedOf(item: RelatedArticleDisplay, now: Date): DatedLine {
	if (item.status === "read" && item.readAt !== undefined) {
		return {
			lead: "You read this",
			time: toRelativePhrase({ iso: item.readAt.toISOString(), now }),
		};
	}
	return {
		lead: "You saved this",
		time: toRelativePhrase({ iso: item.savedAt.toISOString(), now }),
	};
}

function cardsOf(input: NextReadInput): NextReadCard[] {
	const related = input.related;
	if (related?.articles.status !== "ready") return [];
	const item = pickOf({
		items: related.articles.items,
		dismissal: related.dismissal,
		now: related.now,
	});
	if (!item) return [];
	const copy = STATUS_COPY[item.status];
	const tracking = NEXT_READ_TRACKING[item.status];
	return [
		{
			id: item.id.value,
			href: withInternalTracking(`/queue/${item.id.value}/view`, {
				source: "reader",
				content: tracking.clickContent,
				term: related.sourceArticleId,
			}),
			dismissUrl: withInternalTracking(
				`/queue/${related.sourceArticleId}/related-dismiss`,
				{
					source: "reader",
					content: tracking.dismissContent,
					term: related.sourceArticleId,
				},
			),
			returnTo: input.returnTo,
			title: item.title,
			siteName: item.siteName,
			reason: item.reason,
			readStatus: item.status,
			eyebrow: copy.eyebrow,
			statusLabel: copy.statusLabel,
			statusClass: copy.statusClass,
			dated: datedOf(item, related.now),
		},
	];
}

export function renderNextRead(input: NextReadInput): string {
	const cards = cardsOf(input);
	const status = input.related?.articles.status ?? "pending";
	return render(NEXT_READ_TEMPLATE, {
		status,
		stateClass: cards.length > 0 ? READY_CLASS : HIDDEN_CLASS,
		pollUrl: status === "pending" ? input.pollUrl : undefined,
		cards,
	});
}
