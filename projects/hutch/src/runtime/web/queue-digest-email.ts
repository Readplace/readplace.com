import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReaderArticleHashId } from "@packages/domain/article";
import type { ReadlistSlug } from "@packages/domain/readlist";
import { EMAIL_CLICK_MEDIUM } from "@packages/web-analytics";
import { formatLocalInstant, render } from "@packages/web-shell";
import { QUEUE_DIGEST_MIN_SAVE_AGE_DAYS } from "../domain/email/queue-digest-cadence";
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
export const MARK_ALL_READ_LABEL = "Mark all as read";
const STARTER_CONTINUE_LABEL = "Read your Hacker News picks";
const KEEP_READPLACE_LABEL = "Keep Readplace";
export const UNSUBSCRIBE_LABEL = "Stop these emails";
const FOOTER_REASON: Record<QueueDigestKind, string> = {
	regular: `You're getting this because Readplace sends a one-time reminder for articles that stay unread in your readlist for ${QUEUE_DIGEST_MIN_SAVE_AGE_DAYS} days.`,
	pay: "You're getting this because you save articles to Readplace.",
	starter: "You're getting this because you save articles to Readplace.",
};

const QUEUE_DIGEST_UTM_SOURCE = "queue-digest";
const READLIST_PATH = "/queue";
export const QUEUE_DIGEST_UNSUBSCRIBE_PATH = "/email/queue-digest/unsubscribe";
export const QUEUE_DIGEST_MARK_READ_PATH = "/email/queue-digest/mark-read";
const TOKEN_QUERY = "t";
const ONE_CLICK_UNSUBSCRIBE = "List-Unsubscribe=One-Click";

export type QueueDigestKind = "regular" | "pay" | "starter";

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
} & (
	| { kind: "regular"; markReadToken: string }
	| { kind: "pay"; pay: { trialEndsAt: string } }
	| { kind: "starter"; starter: { readlist: ReadlistSlug; campaignId: string } }
);

type QueueDigestLinkContent = "article" | "continue-reading" | "mark-all-read" | "keep-readplace" | "unsubscribe";

type ReadlistButtonContent = Extract<QueueDigestLinkContent, "continue-reading" | "mark-all-read">;

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

interface ReadlistButton {
	content: ReadlistButtonContent;
	url: URL;
	label: string;
	colors: EmailButtonColors;
}

const BUTTON_GAP = "0 12px 12px 0";
const NO_BUTTON_GAP = "0";

interface PayBlock {
	paragraphs: string[];
	keepUrl: string;
}

function trackedLink(input: {
	url: URL;
	kind: QueueDigestKind;
	content: QueueDigestLinkContent;
	sendId: string;
	campaignId: string;
}): string {
	const tracked = new URL(input.url);
	tracked.searchParams.set("utm_source", QUEUE_DIGEST_UTM_SOURCE);
	tracked.searchParams.set("utm_medium", EMAIL_CLICK_MEDIUM);
	tracked.searchParams.set("utm_campaign", input.campaignId);
	tracked.searchParams.set("utm_content", input.content);
	tracked.searchParams.set("utm_term", input.sendId);
	return tracked.toString();
}

function tokenUrl(input: { path: string; token: string; appOrigin: string }): URL {
	const url = new URL(input.path, input.appOrigin);
	url.searchParams.set(TOKEN_QUERY, input.token);
	return url;
}

const INTRO_PARAGRAPH: Record<QueueDigestKind, (count: number) => string> = {
	regular: (count) =>
		count === 1
			? "This article is ready and has been in your readlist for some time but is still unread. This is a one-time reminder about it."
			: `These ${count} articles are ready and have been in your readlist for some time but are still unread. This is a one-time reminder about them.`,
	pay: (count) => `${count} ${count === 1 ? "article you saved is" : "articles you saved are"} ready to read.`,
	starter: (count) =>
		`Readplace selected ten articles from Hacker News for you once. ${count} ${count === 1 ? "pick is" : "picks are"} still unread. They're in All and Hacker News picks; you can read, file, or delete them.`,
};

function readlistButtonsFor(input: { params: QueueDigestEmailParams; readlistUrl: URL }): ReadlistButton[] {
	const { params, readlistUrl } = input;
	switch (params.kind) {
		case "regular":
			return [
				{ content: "continue-reading", url: readlistUrl, label: CONTINUE_READING_LABEL, colors: AMBER_BUTTON },
				{
					content: "mark-all-read",
					url: tokenUrl({ path: QUEUE_DIGEST_MARK_READ_PATH, token: params.markReadToken, appOrigin: params.links.appOrigin }),
					label: MARK_ALL_READ_LABEL,
					colors: NEUTRAL_BUTTON,
				},
			];
		case "pay":
			return [{ content: "continue-reading", url: readlistUrl, label: CONTINUE_READING_LABEL, colors: NEUTRAL_BUTTON }];
		case "starter":
			return [{ content: "continue-reading", url: readlistUrl, label: STARTER_CONTINUE_LABEL, colors: AMBER_BUTTON }];
	}
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
	const starter = params.kind === "starter" ? params.starter : undefined;
	const subject =
		starter === undefined ? QUEUE_DIGEST_EMAIL_SUBJECT : "Your Hacker News picks are ready";
	const link = (url: URL, content: QueueDigestLinkContent) =>
		trackedLink({
			url,
			kind,
			content,
			sendId: links.sendId,
			campaignId: starter?.campaignId ?? kind,
		});

	const cards = params.items.map((item) => ({
		title: item.title,
		siteName: item.siteName,
		preview: item.preview,
		readerUrl: link(
			new URL(buildOwnerReaderPath(item.articleId, starter), links.appOrigin),
			"article",
		),
	}));
	const intro = INTRO_PARAGRAPH[kind](cards.length);
	const footerReason = FOOTER_REASON[kind];
	const readlistUrl = new URL(READLIST_PATH, links.appOrigin);
	if (starter !== undefined) readlistUrl.searchParams.set("queue", starter.readlist);
	const readlistButtons = readlistButtonsFor({ params, readlistUrl }).map((button, index, row) => ({
		href: link(button.url, button.content),
		label: button.label,
		gap: index === row.length - 1 ? NO_BUTTON_GAP : BUTTON_GAP,
		...button.colors,
	}));
	const payBlocks: PayBlock[] =
		params.kind === "pay"
			? [
					{
						paragraphs: payParagraphs(params.pay.trialEndsAt),
						keepUrl: link(new URL(ACCOUNT_PLANS_URL, links.appOrigin), "keep-readplace"),
					},
				]
			: [];
	const oneClickUnsubscribeUrl = tokenUrl({
		path: QUEUE_DIGEST_UNSUBSCRIBE_PATH,
		token: links.unsubscribeToken,
		appOrigin: links.appOrigin,
	});
	const unsubscribeLinkUrl = link(oneClickUnsubscribeUrl, "unsubscribe");

	return {
		subject,
		headers: {
			"List-Unsubscribe": `<${oneClickUnsubscribeUrl.toString()}>`,
			"List-Unsubscribe-Post": ONE_CLICK_UNSUBSCRIBE,
		},
		to(mediaType) {
			if (mediaType === "text/html") {
				return render(TEMPLATE, {
					subject,
					intro,
					items: cards,
					readlistButtons,
					payBlocks,
					keepLabel: KEEP_READPLACE_LABEL,
					replyLine: EMAIL_REPLY_INVITATION,
					footerReason,
					unsubscribeUrl: unsubscribeLinkUrl,
					unsubscribeLabel: UNSUBSCRIBE_LABEL,
					postalAddress: EMAIL_POSTAL_ADDRESS,
					colors: EMAIL_COLORS,
					fontStack: EMAIL_FONT_STACK,
				});
			}

			return [
				subject,
				intro,
				...cards.map((card) =>
					starter === undefined
						? `${card.title}\n${card.readerUrl}`
						: `${card.title}\n${card.preview}\n${card.readerUrl}`,
				),
				...readlistButtons.map((button) => `${button.label}: ${button.href}`),
				...payBlocks.flatMap((block) => [...block.paragraphs, `${KEEP_READPLACE_LABEL}: ${block.keepUrl}`]),
				EMAIL_REPLY_INVITATION,
				`${footerReason} ${UNSUBSCRIBE_LABEL}: ${unsubscribeLinkUrl}`,
				EMAIL_POSTAL_ADDRESS,
			].join("\n\n");
		},
	};
}
