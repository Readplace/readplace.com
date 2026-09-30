import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReaderArticleHashId } from "@packages/domain/article";
import { EMAIL_CLICK_MEDIUM } from "@packages/web-analytics";
import { formatLocalInstant, render } from "@packages/web-shell";
import { payCutoff } from "../domain/stripe/stripe-trial-config";
import { EMAIL_COLORS, EMAIL_FONT_STACK } from "./email-colors";
import { EMAIL_POSTAL_ADDRESS, EMAIL_REPLY_INVITATION } from "./email-copy";
import { ACCOUNT_PLANS_URL } from "./pages/account/account.url";
import { buildOwnerReaderPath } from "./pages/readlist/owner-reader-link";

const TEMPLATE = readFileSync(
	join(__dirname, "queue-digest-email.template.html"),
	"utf-8",
);

export const QUEUE_DIGEST_EMAIL_SUBJECT = "Waiting in your readlist";
const CONTINUE_READING_LABEL = "Continue reading";
const KEEP_READPLACE_LABEL = "Keep Readplace";
export const UNSUBSCRIBE_LABEL = "Stop these emails";
const FOOTER_REASON = "You're getting this because you save articles to Readplace.";

const QUEUE_DIGEST_UTM_SOURCE = "queue-digest";
const READLIST_PATH = "/queue";
export const QUEUE_DIGEST_UNSUBSCRIBE_PATH = "/email/queue-digest/unsubscribe";
const UNSUBSCRIBE_TOKEN_QUERY = "t";
const ONE_CLICK_UNSUBSCRIBE = "List-Unsubscribe=One-Click";

export type QueueDigestKind = "regular" | "pay";

export interface QueueDigestEmailItem {
	articleId: ReaderArticleHashId;
	title: string;
	siteName: string;
	preview: string;
}

export interface QueueDigestLinks {
	appOrigin: string;
	sendId: string;
	unsubscribeToken: string;
}

type QueueDigestEmailParams = {
	items: QueueDigestEmailItem[];
	links: QueueDigestLinks;
} & ({ kind: "regular" } | { kind: "pay"; pay: { trialEndsAt: string } });

type QueueDigestLinkContent = "article" | "continue-reading" | "keep-readplace" | "unsubscribe";

interface QueueDigestEmailComponent {
	subject: string;
	headers: Record<string, string>;
	to: (mediaType: "text/html" | "text/plain") => string;
}

interface EmailButtonColors {
	fill: string;
	ink: string;
	edge: string;
}

const AMBER_BUTTON: EmailButtonColors = {
	fill: EMAIL_COLORS.primary,
	ink: EMAIL_COLORS.primaryForeground,
	edge: EMAIL_COLORS.primary,
};

const NEUTRAL_BUTTON: EmailButtonColors = {
	fill: EMAIL_COLORS.card,
	ink: EMAIL_COLORS.foreground,
	edge: EMAIL_COLORS.border,
};

const CONTINUE_READING_BUTTON: Record<QueueDigestKind, EmailButtonColors> = {
	regular: AMBER_BUTTON,
	pay: NEUTRAL_BUTTON,
};

interface PayBlock {
	paragraphs: string[];
	keepUrl: string;
}

function trackedLink(input: {
	url: URL;
	kind: QueueDigestKind;
	content: QueueDigestLinkContent;
	sendId: string;
}): string {
	const tracked = new URL(input.url);
	tracked.searchParams.set("utm_source", QUEUE_DIGEST_UTM_SOURCE);
	tracked.searchParams.set("utm_medium", EMAIL_CLICK_MEDIUM);
	tracked.searchParams.set("utm_campaign", input.kind);
	tracked.searchParams.set("utm_content", input.content);
	tracked.searchParams.set("utm_term", input.sendId);
	return tracked.toString();
}

function unsubscribeUrl(links: QueueDigestLinks): URL {
	const url = new URL(QUEUE_DIGEST_UNSUBSCRIBE_PATH, links.appOrigin);
	url.searchParams.set(UNSUBSCRIBE_TOKEN_QUERY, links.unsubscribeToken);
	return url;
}

function introLine(count: number): string {
	const phrase = count === 1 ? "article you saved is" : "articles you saved are";
	return `${count} ${phrase} ready to read.`;
}

function payParagraphs(trialEndsAt: string): string[] {
	const trialEnd = formatLocalInstant({ iso: trialEndsAt, style: "date", timeZone: "UTC" });
	const cutoff = formatLocalInstant({ iso: payCutoff(trialEndsAt), style: "datetime", timeZone: "UTC" });
	return [
		`Choose a plan before ${cutoff} and nothing is charged until ${trialEnd}. After that, choosing a plan starts it the same day.`,
	];
}

export function QueueDigestEmail(params: QueueDigestEmailParams): QueueDigestEmailComponent {
	const { links, kind } = params;
	const link = (url: URL, content: QueueDigestLinkContent) =>
		trackedLink({ url, kind, content, sendId: links.sendId });

	const cards = params.items.map((item) => ({
		title: item.title,
		siteName: item.siteName,
		preview: item.preview,
		readerUrl: link(new URL(buildOwnerReaderPath(item.articleId), links.appOrigin), "article"),
	}));
	const intro = introLine(cards.length);
	const continueReadingUrl = link(new URL(READLIST_PATH, links.appOrigin), "continue-reading");
	const payBlocks: PayBlock[] =
		params.kind === "pay"
			? [
					{
						paragraphs: payParagraphs(params.pay.trialEndsAt),
						keepUrl: link(new URL(ACCOUNT_PLANS_URL, links.appOrigin), "keep-readplace"),
					},
				]
			: [];
	const oneClickUnsubscribeUrl = unsubscribeUrl(links);
	const unsubscribeLinkUrl = link(oneClickUnsubscribeUrl, "unsubscribe");

	return {
		subject: QUEUE_DIGEST_EMAIL_SUBJECT,
		headers: {
			"List-Unsubscribe": `<${oneClickUnsubscribeUrl.toString()}>`,
			"List-Unsubscribe-Post": ONE_CLICK_UNSUBSCRIBE,
		},
		to(mediaType) {
			if (mediaType === "text/html") {
				return render(TEMPLATE, {
					subject: QUEUE_DIGEST_EMAIL_SUBJECT,
					intro,
					items: cards,
					continueReading: {
						href: continueReadingUrl,
						label: CONTINUE_READING_LABEL,
						...CONTINUE_READING_BUTTON[kind],
					},
					payBlocks,
					keepLabel: KEEP_READPLACE_LABEL,
					replyLine: EMAIL_REPLY_INVITATION,
					footerReason: FOOTER_REASON,
					unsubscribeUrl: unsubscribeLinkUrl,
					unsubscribeLabel: UNSUBSCRIBE_LABEL,
					postalAddress: EMAIL_POSTAL_ADDRESS,
					colors: EMAIL_COLORS,
					fontStack: EMAIL_FONT_STACK,
				});
			}

			return [
				QUEUE_DIGEST_EMAIL_SUBJECT,
				intro,
				...cards.map((card) => `${card.title}\n${card.readerUrl}`),
				`${CONTINUE_READING_LABEL}: ${continueReadingUrl}`,
				...payBlocks.flatMap((block) => [...block.paragraphs, `${KEEP_READPLACE_LABEL}: ${block.keepUrl}`]),
				EMAIL_REPLY_INVITATION,
				`${FOOTER_REASON} ${UNSUBSCRIBE_LABEL}: ${unsubscribeLinkUrl}`,
				EMAIL_POSTAL_ADDRESS,
			].join("\n\n");
		},
	};
}
