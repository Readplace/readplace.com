import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import {
	MARK_ALL_READ_LABEL,
	QUEUE_DIGEST_EMAIL_SUBJECT,
	QUEUE_DIGEST_MARK_READ_PATH,
} from "../../queue-digest-email";
import { READLIST_PATH } from "../readlist/readlist.url";
import { QUEUE_DIGEST_MARK_READ_STYLES } from "./queue-digest-mark-read.styles";

const QUEUE_DIGEST_MARK_READ_TEMPLATE = readFileSync(
	join(__dirname, "queue-digest-mark-read.template.html"),
	"utf-8",
);

export type QueueDigestMarkReadState =
	| { kind: "confirm"; token: string; count: number }
	| { kind: "done"; count: number }
	| { kind: "invalid" };

const DIGEST_EMAIL = `your “${QUEUE_DIGEST_EMAIL_SUBJECT}” email`;
const TRACKING_SOURCE = "queue-digest-mark-read";

interface PageCopy {
	title: string;
	body: string;
	statusCode: number;
}

function countedArticles(count: number) {
	return count === 1
		? { these: "this article", articles: "1 article", stay: "It stays", are: "is" }
		: { these: "these articles", articles: `${count} articles`, stay: "They stay", are: "are" };
}

function copyFor(state: QueueDigestMarkReadState): PageCopy {
	switch (state.kind) {
		case "confirm": {
			const counted = countedArticles(state.count);
			return {
				title: `Mark ${counted.these} as read?`,
				body: `This marks the ${counted.articles} from ${DIGEST_EMAIL} as read. ${counted.stay} saved in your readlist.`,
				statusCode: 200,
			};
		}
		case "done": {
			const counted = countedArticles(state.count);
			return {
				title: "Marked as read",
				body: `The ${counted.articles} from ${DIGEST_EMAIL} ${counted.are} marked as read.`,
				statusCode: 200,
			};
		}
		case "invalid":
			return {
				title: "Couldn't read this mark-as-read link",
				body: "The link is incomplete or has been changed, so no articles were marked as read. You can mark them as read from your readlist.",
				statusCode: 400,
			};
	}
}

interface PageAction {
	key: "confirm" | "readlist";
	method: "GET" | "POST";
	action: string;
	fields: { name: string; value: string }[];
	label: string;
}

function trackingFields(content: string): { name: string; value: string }[] {
	const tracked = new URL(withInternalTracking(READLIST_PATH, { source: TRACKING_SOURCE, content }), "https://readplace.com");
	return Array.from(tracked.searchParams, ([name, value]) => ({ name, value }));
}

function actionsFor(state: QueueDigestMarkReadState): PageAction[] {
	if (state.kind === "confirm") {
		return [
			{
				key: "confirm",
				method: "POST",
				action: withInternalTracking(
					`${QUEUE_DIGEST_MARK_READ_PATH}?${new URLSearchParams({ t: state.token }).toString()}`,
					{ source: TRACKING_SOURCE, content: "confirm" },
				),
				fields: [],
				label: MARK_ALL_READ_LABEL,
			},
		];
	}
	return [{ key: "readlist", method: "GET", action: READLIST_PATH, fields: trackingFields("go-to-readlist"), label: "Go to your readlist" }];
}

export function QueueDigestMarkReadPage(state: QueueDigestMarkReadState): PageBody {
	const copy = copyFor(state);
	return {
		seo: {
			title: `${copy.title} — Readplace`,
			description: copy.body,
			canonicalUrl: QUEUE_DIGEST_MARK_READ_PATH,
			robots: "noindex, nofollow",
		},
		styles: QUEUE_DIGEST_MARK_READ_STYLES,
		bodyClass: "page-queue-digest-mark-read",
		statusCode: copy.statusCode,
		content: {
			html: render(QUEUE_DIGEST_MARK_READ_TEMPLATE, {
				state: state.kind,
				title: copy.title,
				body: copy.body,
				actions: actionsFor(state),
			}),
		},
	};
}
