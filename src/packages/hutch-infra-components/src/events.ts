import { z } from "zod";

type HutchEvent<T extends z.ZodTypeAny> = {
	readonly name: string;
	readonly source: string;
	readonly detailType: string;
	readonly detailSchema: T;
};

function defineEvent<T extends z.ZodTypeAny>(definition: {
	name: string;
	source: string;
	detailType: string;
	detailSchema: T;
}): HutchEvent<T> {
	return Object.freeze(definition);
}

type HutchCommand<T extends z.ZodTypeAny> = {
	readonly detailSchema: T;
};

function defineCommand<T extends z.ZodTypeAny>(definition: {
	detailSchema: T;
}): HutchCommand<T> {
	return Object.freeze(definition);
}

export const SaveLinkCommand = defineEvent({
	name: "save-link-command",
	source: "hutch.api",
	detailType: "SaveLinkCommand",
	detailSchema: z.object({
		url: z.string(),
		userId: z.string(),
	}),
});
export type SaveLinkDetail = z.infer<typeof SaveLinkCommand.detailSchema>;

export const SaveLinkRawHtmlCommand = defineEvent({
	name: "save-link-raw-html-command",
	source: "hutch.api",
	detailType: "SaveLinkRawHtmlCommand",
	detailSchema: z.object({
		url: z.string(),
		userId: z.string(),
		title: z.string().optional(),
	}),
});
export type SaveLinkRawHtmlDetail = z.infer<typeof SaveLinkRawHtmlCommand.detailSchema>;

export const SaveAnonymousLinkCommand = defineEvent({
	name: "save-anonymous-link-command",
	source: "hutch.api",
	detailType: "SaveAnonymousLinkCommand",
	detailSchema: z.object({
		url: z.string(),
	}),
});
export type SaveAnonymousLinkDetail = z.infer<
	typeof SaveAnonymousLinkCommand.detailSchema
>;

/** Unified entry-point command for the redesigned save flow.
 *
 * Issued by hutch (user save / anonymous /view / operator recrawl) and
 * re-issued by save-link's effect dispatcher when the aggregate's
 * `submitLink` or `requestRecrawl` transitions fire. The future
 * `submit-link` Lambda branches on `rawHtml`-present (tier-0 path) vs
 * absent (tier-1 URL fetch path) and on `userId`-present (authenticated
 * save) vs absent (anonymous /view save). Routes via EventBridge — no
 * dedicated SQS queue required at the publisher. */
export const SubmitLinkCommand = defineEvent({
	name: "submit-link-command",
	source: "hutch.api",
	detailType: "SubmitLinkCommand",
	detailSchema: z.object({
		url: z.string(),
		userId: z.string().optional(),
		rawHtml: z.string().optional(),
	}),
});
export type SubmitLinkDetail = z.infer<typeof SubmitLinkCommand.detailSchema>;

/** Irreversible fact: the simple crawl reported `unsupported` for a URL.
 * Published by `save-link-work` (initial save / recrawl) and by the
 * `stale-check` Lambda (freshness refresh), so the publishing Lambda's
 * concurrency slot is released immediately. The
 * `simple-crawl-unsupported-policy` Lambda subscribes to this event and
 * dispatches `ComprehensiveCrawlCommand` so the dedicated PDF-handling
 * Lambda picks up the URL.
 *
 * `userId` is threaded so the downstream selector can emit `LinkSavedEvent`
 * with the original saver. `recrawl=true` tells the comprehensive handler
 * to emit `RecrawlContentExtractedEvent` instead of
 * `TierContentExtractedEvent`, preserving the recrawl chain's
 * always-regenerate-summary semantics. `refresh=true` tells the comprehensive
 * handler to emit `RefreshContentExtractedEvent` so the stale-check chain's
 * tier-selection + canonical write still runs. `recrawl` and `refresh` are
 * mutually exclusive — each carries different downstream semantics. */
export const SimpleCrawlUnsupportedEvent = defineEvent({
	name: "simple-crawl-unsupported",
	source: "hutch.save-link",
	detailType: "SimpleCrawlUnsupported",
	detailSchema: z.object({
		url: z.string(),
		userId: z.string().optional(),
		recrawl: z.boolean().optional(),
		refresh: z.boolean().optional(),
	}).refine(
		(d) => !(d.recrawl && d.refresh),
		{ message: "recrawl and refresh are mutually exclusive" },
	),
});
export type SimpleCrawlUnsupportedDetail = z.infer<
	typeof SimpleCrawlUnsupportedEvent.detailSchema
>;

/** Async dispatch of the comprehensive crawl (PDF extraction) path.
 * Dispatched by the `simple-crawl-unsupported-policy` Lambda in reaction
 * to `SimpleCrawlUnsupportedEvent`. The dedicated comprehensive-crawl-command
 * Lambda subscribes to this command, runs the comprehensive crawl, processes
 * the result through the same tier-1 happy path, and emits the appropriate
 * downstream event itself (TierContentExtractedEvent for saves,
 * RecrawlContentExtractedEvent for recrawls, RefreshContentExtractedEvent
 * for stale-check refreshes).
 *
 * `userId` is threaded so the downstream selector can emit `LinkSavedEvent`
 * with the original saver. `recrawl=true` tells the handler to emit
 * `RecrawlContentExtractedEvent` instead of `TierContentExtractedEvent`,
 * preserving the recrawl Lambda chain's always-regenerate-summary semantics.
 * `refresh=true` tells the handler to emit `RefreshContentExtractedEvent`,
 * keeping the stale-check tier-selection + canonical write flow intact.
 * `recrawl` and `refresh` are mutually exclusive. */
export const ComprehensiveCrawlCommand = defineEvent({
	name: "comprehensive-crawl-command",
	source: "hutch.save-link",
	detailType: "ComprehensiveCrawlCommand",
	detailSchema: z.object({
		url: z.string(),
		userId: z.string().optional(),
		recrawl: z.boolean().optional(),
		refresh: z.boolean().optional(),
	}).refine(
		(d) => !(d.recrawl && d.refresh),
		{ message: "recrawl and refresh are mutually exclusive" },
	),
});
export type ComprehensiveCrawlDetail = z.infer<
	typeof ComprehensiveCrawlCommand.detailSchema
>;

export const StaleCheckRequestedEvent = defineEvent({
	name: "stale-check-requested",
	source: "hutch.api",
	detailType: "StaleCheckRequested",
	detailSchema: z.object({
		url: z.string(),
	}),
});
export type StaleCheckRequestedDetail = z.infer<
	typeof StaleCheckRequestedEvent.detailSchema
>;

export const LinkSavedEvent = defineEvent({
	name: "link-saved",
	source: "hutch.save-link",
	detailType: "LinkSaved",
	detailSchema: z.object({
		url: z.string(),
		userId: z.string(),
	}),
});
export type LinkSavedDetail = z.infer<typeof LinkSavedEvent.detailSchema>;

export const AnonymousLinkSavedEvent = defineEvent({
	name: "anonymous-link-saved",
	source: "hutch.save-link",
	detailType: "AnonymousLinkSaved",
	detailSchema: z.object({
		url: z.string(),
	}),
});
export type AnonymousLinkSavedDetail = z.infer<
	typeof AnonymousLinkSavedEvent.detailSchema
>;

export const SummaryGeneratedEvent = defineEvent({
	name: "summary-generated",
	source: "hutch.save-link",
	detailType: "GlobalSummaryGenerated",
	detailSchema: z.object({
		url: z.string(),
		inputTokens: z.number(),
		outputTokens: z.number(),
	}),
});
export type SummaryGeneratedDetail = z.infer<typeof SummaryGeneratedEvent.detailSchema>;

export const SummaryGenerationFailedEvent = defineEvent({
	name: "summary-generation-failed",
	source: "hutch.save-link",
	detailType: "SummaryGenerationFailed",
	detailSchema: z.object({
		url: z.string(),
		reason: z.string(),
		receiveCount: z.number(),
	}),
});
export type SummaryGenerationFailedDetail = z.infer<
	typeof SummaryGenerationFailedEvent.detailSchema
>;

export const TierContentExtractedEvent = defineEvent({
	name: "tier-content-extracted",
	source: "hutch.save-link",
	detailType: "TierContentExtracted",
	detailSchema: z.object({
		url: z.string(),
		tier: z.enum(["tier-0", "tier-1"]),
		userId: z.string().optional(),
	}),
});
export type TierContentExtractedDetail = z.infer<
	typeof TierContentExtractedEvent.detailSchema
>;

export const CrawlArticleCompletedEvent = defineEvent({
	name: "crawl-article-completed",
	source: "hutch.save-link",
	detailType: "CrawlArticleCompleted",
	detailSchema: z.object({
		url: z.string(),
	}),
});
export type CrawlArticleCompletedDetail = z.infer<
	typeof CrawlArticleCompletedEvent.detailSchema
>;

export const CrawlArticleFailedEvent = defineEvent({
	name: "crawl-article-failed",
	source: "hutch.save-link",
	detailType: "CrawlArticleFailed",
	detailSchema: z.object({
		url: z.string(),
		reason: z.string(),
		receiveCount: z.number(),
	}),
});
export type CrawlArticleFailedDetail = z.infer<
	typeof CrawlArticleFailedEvent.detailSchema
>;

export const RecrawlLinkInitiatedEvent = defineEvent({
	name: "recrawl-link-initiated",
	source: "hutch.api",
	detailType: "RecrawlLinkInitiated",
	detailSchema: z.object({
		url: z.string(),
	}),
});
export type RecrawlLinkInitiatedDetail = z.infer<
	typeof RecrawlLinkInitiatedEvent.detailSchema
>;

export const RecrawlContentExtractedEvent = defineEvent({
	name: "recrawl-content-extracted",
	source: "hutch.save-link",
	detailType: "RecrawlContentExtracted",
	detailSchema: z.object({
		url: z.string(),
	}),
});
export type RecrawlContentExtractedDetail = z.infer<
	typeof RecrawlContentExtractedEvent.detailSchema
>;

export const RefreshContentExtractedEvent = defineEvent({
	name: "refresh-content-extracted",
	source: "hutch.save-link",
	detailType: "RefreshContentExtracted",
	detailSchema: z.object({
		url: z.string(),
		etag: z.string().optional(),
		lastModified: z.string().optional(),
		contentFetchedAt: z.string(),
	}),
});
export type RefreshContentExtractedDetail = z.infer<
	typeof RefreshContentExtractedEvent.detailSchema
>;

export const RecrawlCompletedEvent = defineEvent({
	name: "recrawl-completed",
	source: "hutch.save-link",
	detailType: "RecrawlCompleted",
	detailSchema: z.object({
		url: z.string(),
	}),
});
export type RecrawlCompletedDetail = z.infer<
	typeof RecrawlCompletedEvent.detailSchema
>;

export const GenerateSummaryCommand = defineCommand({
	detailSchema: z.object({
		url: z.string(),
	}),
});
export type GenerateSummaryDetail = z.infer<typeof GenerateSummaryCommand.detailSchema>;

export const RefreshArticleContentCommand = defineEvent({
	name: "refresh-article-content-command",
	source: "hutch.api",
	detailType: "RefreshArticleContentCommand",
	detailSchema: z.object({
		url: z.string(),
		html: z.string(),
		metadata: z.object({
			title: z.string(),
			siteName: z.string(),
			excerpt: z.string(),
			wordCount: z.number(),
			imageUrl: z.string().optional(),
		}),
		estimatedReadTime: z.number(),
		etag: z.string().optional(),
		lastModified: z.string().optional(),
		contentFetchedAt: z.string(),
	}),
});
export type RefreshArticleContentDetail = z.infer<
	typeof RefreshArticleContentCommand.detailSchema
>;

export const ExportUserDataCommand = defineEvent({
	name: "export-user-data-command",
	source: "hutch.api",
	detailType: "ExportUserDataCommand",
	detailSchema: z.object({
		userId: z.string(),
		email: z.string(),
		requestedAt: z.string(),
	}),
});
export type ExportUserDataDetail = z.infer<typeof ExportUserDataCommand.detailSchema>;

export const UserDataExportedEvent = defineEvent({
	name: "user-data-exported",
	source: "hutch.export-user-data",
	detailType: "UserDataExported",
	detailSchema: z.object({
		userId: z.string(),
		articleCount: z.number(),
		s3Key: z.string(),
		exportedAt: z.string(),
	}),
});
export type UserDataExportedDetail = z.infer<typeof UserDataExportedEvent.detailSchema>;

export const UserDataExportFailedEvent = defineEvent({
	name: "user-data-export-failed",
	source: "hutch.export-user-data",
	detailType: "UserDataExportFailed",
	detailSchema: z.object({
		userId: z.string(),
		reason: z.string(),
		receiveCount: z.number(),
	}),
});
export type UserDataExportFailedDetail = z.infer<typeof UserDataExportFailedEvent.detailSchema>;

export const UpdateFetchTimestampCommand = defineEvent({
	name: "update-fetch-timestamp-command",
	source: "hutch.api",
	detailType: "UpdateFetchTimestampCommand",
	detailSchema: z.object({
		url: z.string(),
		contentFetchedAt: z.string(),
	}),
});
export type UpdateFetchTimestampDetail = z.infer<
	typeof UpdateFetchTimestampCommand.detailSchema
>;

export type { HutchEvent, HutchCommand };
