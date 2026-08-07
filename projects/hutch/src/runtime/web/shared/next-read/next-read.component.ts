import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RelatedArticles } from "@packages/provider-contracts/related-articles";
import { render, toRelativePhrase, withInternalTracking } from "@packages/web-shell";
import type { LocalTime } from "@packages/web-shell/local-time.format";

const NEXT_READ_TEMPLATE = readFileSync(
	join(__dirname, "next-read.template.html"),
	"utf-8",
);

const READY_CLASS = "next-read--ready";
const HIDDEN_CLASS = "next-read--hidden";

export const NEXT_READ_SCRIPT =
	'<script src="/client-dist/next-read.client.js" defer></script>';

export interface NextReadContext {
	articles: RelatedArticles;
	sourceArticleId: string;
	now: Date;
}

export interface NextReadInput {
	related?: NextReadContext;
	pollUrl?: string;
	returnTo: string;
}

interface NextReadCard {
	id: string;
	href: string;
	dismissUrl: string;
	returnTo: string;
	title: string;
	siteName: string;
	reason: string;
	saved: LocalTime;
}

function cardsOf(input: NextReadInput): NextReadCard[] {
	const related = input.related;
	if (related?.articles.status !== "ready") return [];
	return related.articles.items.slice(0, 1).map((item) => ({
		id: item.id.value,
		href: withInternalTracking(`/queue/${item.id.value}/view`, {
			source: "reader",
			content: "related",
			term: related.sourceArticleId,
		}),
		dismissUrl: withInternalTracking(
			`/queue/${related.sourceArticleId}/related-dismiss`,
			{ source: "reader", content: "next-read-dismiss", term: related.sourceArticleId },
		),
		returnTo: input.returnTo,
		title: item.title,
		siteName: item.siteName,
		reason: item.reason,
		saved: toRelativePhrase({ iso: item.savedAt.toISOString(), now: related.now }),
	}));
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
