import type {
	NewsletterMessage,
	NewsletterMessageSummary,
} from "@packages/domain/newsletter";
import { buildReaderIframeSrcdoc } from "../../shared/article-body/reader-slot/reader-iframe-srcdoc";

const MONTHS = [
	"Jan", "Feb", "Mar", "Apr", "May", "Jun",
	"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Renders an ISO instant as a stable UTC label, independent of server locale
 * so route-test assertions are deterministic. */
export function formatReceivedAt(iso: string): string {
	const date = new Date(iso);
	const day = date.getUTCDate();
	const month = MONTHS[date.getUTCMonth()];
	const year = date.getUTCFullYear();
	const hours = String(date.getUTCHours()).padStart(2, "0");
	const minutes = String(date.getUTCMinutes()).padStart(2, "0");
	return `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
}

function displaySubject(subject: string): string {
	return subject === "" ? "(no subject)" : subject;
}

export interface NewsletterListItemViewModel {
	readonly id: string;
	readonly subject: string;
	readonly receivedAt: string;
	readonly savedCount: number;
	readonly href: string;
}

export interface NewsletterListViewModel {
	readonly address: string;
	readonly messages: readonly NewsletterListItemViewModel[];
	readonly hasMessages: boolean;
}

export function toNewsletterListViewModel(input: {
	address: string;
	messages: readonly NewsletterMessageSummary[];
}): NewsletterListViewModel {
	return {
		address: input.address,
		hasMessages: input.messages.length > 0,
		messages: input.messages.map((message) => ({
			id: message.id,
			subject: displaySubject(message.subject),
			receivedAt: formatReceivedAt(message.receivedAt),
			savedCount: message.savedCount,
			href: `/newsletter/${message.id}`,
		})),
	};
}

export interface NewsletterLinkViewModel {
	readonly displayUrl: string;
	readonly href: string;
}

export interface NewsletterDetailViewModel {
	readonly subject: string;
	readonly fromAddress: string;
	readonly receivedAt: string;
	readonly srcdoc: string;
	readonly links: readonly NewsletterLinkViewModel[];
	readonly hasLinks: boolean;
	readonly savedCount: number;
	readonly skippedCount: number;
	readonly hasSkipped: boolean;
}

export function toNewsletterDetailViewModel(
	message: NewsletterMessage,
): NewsletterDetailViewModel {
	return {
		subject: displaySubject(message.subject),
		fromAddress: message.fromAddress,
		receivedAt: formatReceivedAt(message.receivedAt),
		srcdoc: buildReaderIframeSrcdoc({ content: message.html }),
		links: message.savedLinks.map((link) => ({
			displayUrl: link.url,
			href: `/queue/${link.articleId}/view`,
		})),
		hasLinks: message.savedLinks.length > 0,
		savedCount: message.savedLinks.length,
		skippedCount: message.skippedCount,
		hasSkipped: message.skippedCount > 0,
	};
}
