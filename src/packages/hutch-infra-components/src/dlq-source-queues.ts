import { SAVE_LINK_LAMBDA_NAMES } from "./save-link-lambdas";

export const SAVE_LINK_DLQ_SOURCES = {
	saveLinkCommand: SAVE_LINK_LAMBDA_NAMES.saveLinkCommand,
	submitLink: SAVE_LINK_LAMBDA_NAMES.submitLink,
	saveLinkRawHtmlCommand: SAVE_LINK_LAMBDA_NAMES.saveLinkRawHtmlCommand,
	saveAnonymousLinkCommand: SAVE_LINK_LAMBDA_NAMES.saveAnonymousLinkCommand,
	simpleCrawlUnsupportedPolicy: "simple-crawl-unsupported-policy",
	comprehensiveCrawlCommand: SAVE_LINK_LAMBDA_NAMES.comprehensiveCrawlCommand,
	saveLinkRawPdfCommand: SAVE_LINK_LAMBDA_NAMES.saveLinkRawPdfCommand,
	selectMostCompleteContent: SAVE_LINK_LAMBDA_NAMES.selectMostCompleteContent,
	reselectAfterRemoval: SAVE_LINK_LAMBDA_NAMES.reselectAfterRemoval,
	generateSummary: "generate-summary",
	recrawlLinkInitiated: SAVE_LINK_LAMBDA_NAMES.recrawlLinkInitiated,
	recrawlContentExtracted: "recrawl-content-extracted",
	filterEmailLinks: SAVE_LINK_LAMBDA_NAMES.filterEmailLinks,
} as const;

export const INBOX_DLQ_SOURCES = {
	extractEmailLinks: "inbox-extract-email-links",
	crawlEmailLinkPreview: "inbox-crawl-email-link-preview",
	confirmGmailForwarding: "inbox-confirm-gmail-forwarding",
	ingestGmailImport: "inbox-ingest-gmail-import",
} as const;

export const GMAIL_HISTORY_IMPORT_DLQ_SOURCES = {
	pages: "gmail-history-import",
	outcomes: "gmail-history-import-outcomes",
} as const;

type SqsQueueName<T extends string> = `${T}-q`;

type QueueNamesFor<Sources extends Record<string, string>> = {
	readonly [K in keyof Sources]: SqsQueueName<Sources[K]>;
};

export const SAVE_LINK_DLQ_SOURCE_QUEUES = {
	saveLinkCommand: `${SAVE_LINK_DLQ_SOURCES.saveLinkCommand}-q`,
	submitLink: `${SAVE_LINK_DLQ_SOURCES.submitLink}-q`,
	saveLinkRawHtmlCommand: `${SAVE_LINK_DLQ_SOURCES.saveLinkRawHtmlCommand}-q`,
	saveAnonymousLinkCommand: `${SAVE_LINK_DLQ_SOURCES.saveAnonymousLinkCommand}-q`,
	simpleCrawlUnsupportedPolicy: `${SAVE_LINK_DLQ_SOURCES.simpleCrawlUnsupportedPolicy}-q`,
	comprehensiveCrawlCommand: `${SAVE_LINK_DLQ_SOURCES.comprehensiveCrawlCommand}-q`,
	saveLinkRawPdfCommand: `${SAVE_LINK_DLQ_SOURCES.saveLinkRawPdfCommand}-q`,
	selectMostCompleteContent: `${SAVE_LINK_DLQ_SOURCES.selectMostCompleteContent}-q`,
	reselectAfterRemoval: `${SAVE_LINK_DLQ_SOURCES.reselectAfterRemoval}-q`,
	generateSummary: `${SAVE_LINK_DLQ_SOURCES.generateSummary}-q`,
	recrawlLinkInitiated: `${SAVE_LINK_DLQ_SOURCES.recrawlLinkInitiated}-q`,
	recrawlContentExtracted: `${SAVE_LINK_DLQ_SOURCES.recrawlContentExtracted}-q`,
	filterEmailLinks: `${SAVE_LINK_DLQ_SOURCES.filterEmailLinks}-q`,
} as const satisfies QueueNamesFor<typeof SAVE_LINK_DLQ_SOURCES>;

export const INBOX_DLQ_SOURCE_QUEUES = {
	extractEmailLinks: `${INBOX_DLQ_SOURCES.extractEmailLinks}-q`,
	crawlEmailLinkPreview: `${INBOX_DLQ_SOURCES.crawlEmailLinkPreview}-q`,
	confirmGmailForwarding: `${INBOX_DLQ_SOURCES.confirmGmailForwarding}-q`,
	ingestGmailImport: `${INBOX_DLQ_SOURCES.ingestGmailImport}-q`,
} as const satisfies QueueNamesFor<typeof INBOX_DLQ_SOURCES>;

export const GMAIL_HISTORY_IMPORT_DLQ_SOURCE_QUEUES = {
	pages: `${GMAIL_HISTORY_IMPORT_DLQ_SOURCES.pages}-q`,
	outcomes: `${GMAIL_HISTORY_IMPORT_DLQ_SOURCES.outcomes}-q`,
} as const satisfies QueueNamesFor<typeof GMAIL_HISTORY_IMPORT_DLQ_SOURCES>;
