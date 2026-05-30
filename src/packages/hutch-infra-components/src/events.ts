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
		/* SHA-256 of the previously-fetched body — only set on the refresh
		 * chain. Threaded through to the comprehensive Lambda so it can
		 * short-circuit a re-fetch of an unchanged PDF without paying the
		 * mupdf walk. Save / recrawl chains never carry it (no prior body to
		 * compare against). */
		previousBodyHash: z.string().optional(),
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
		/* SHA-256 of the previously-fetched body — only set on the refresh
		 * chain. Forwarded from the upstream SimpleCrawlUnsupportedEvent so
		 * the crawl library can short-circuit a 200 OK whose body matches the
		 * previously-stored bytes, skipping the PDF extraction step. */
		previousBodyHash: z.string().optional(),
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

/** Irreversible fact: the content-selection authority (re)established the
 * canonical readable content for a URL. Published by the tier selector when the
 * canonical tier flipped OR the canonical readable text changed. The
 * `canonical-content-changed` Lambda subscribes and re-primes the summary axis
 * so the generate-summary worker regenerates against the new canonical instead
 * of cache-hitting a stale terminal summary. Derived-artifact consumers added
 * later (transcript, embeddings) attach as new `eventBus.subscribe`s without
 * touching the publisher (OCP) — staleness comparison lives here, once, not in
 * each consumer. */
export const CanonicalContentChangedEvent = defineEvent({
	name: "canonical-content-changed",
	source: "hutch.save-link",
	detailType: "CanonicalContentChanged",
	detailSchema: z.object({
		url: z.string(),
	}),
});
export type CanonicalContentChangedDetail = z.infer<
	typeof CanonicalContentChangedEvent.detailSchema
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
		/* SHA-256 of the freshly-fetched body. The refresh-content-extracted
		 * persister writes this onto the freshness row so the next refresh
		 * tick can pass it back into the crawl library as `previousBodyHash`
		 * and gate the parse. Optional for backward compatibility with
		 * in-flight events at deploy time. */
		bodyHash: z.string().optional(),
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

/** Refresh handler reads the freshly-fetched HTML from S3 (refresh-html/ prefix
 * in PENDING_HTML_BUCKET) using the same key derivation the publisher used —
 * mirrors the SaveLinkRawHtmlCommand pattern. Inlining the HTML in this detail
 * blew past EventBridge's 256 KB per-request cap for large articles. */
export const RefreshArticleContentCommand = defineEvent({
	name: "refresh-article-content-command",
	source: "hutch.api",
	detailType: "RefreshArticleContentCommand",
	detailSchema: z.object({
		url: z.string(),
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
		/* SHA-256 of the freshly-fetched body — forwarded to the downstream
		 * RefreshContentExtractedEvent so the persister can land it on the
		 * row alongside etag / lastModified. Optional for backward
		 * compatibility with in-flight commands at deploy time. */
		bodyHash: z.string().optional(),
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
		/* SHA-256 of the body that proved unchanged. Carried forward so a
		 * row that previously had no `bodyHash` (legacy / first refresh) lands
		 * one on the first 200-OK-with-matching-bytes hit. Optional because
		 * the 304 Not Modified branch never computes a hash. */
		bodyHash: z.string().optional(),
	}),
});
export type UpdateFetchTimestampDetail = z.infer<
	typeof UpdateFetchTimestampCommand.detailSchema
>;

/** Broadened in Phase 2 to carry `userId` so handlers can update the row by
 * primary key instead of GSI-querying on `subscriptionId`. Emitted by the
 * `cancel-subscription` Lambda for every user-initiated cancel (trialing →
 * no `subscriptionId`; active and pending_cancellation → with `subscriptionId`)
 * and by `stripe-webhook-receiver` on `customer.subscription.deleted` for
 * Stripe-side cancellations (dashboard, dunning). Both paths can fire for the
 * same cancel; `handle-subscription-cancelled` is idempotent so duplicate
 * emits are safe. `reason` is audit-only. */
export const SubscriptionCancelledEvent = defineEvent({
	name: "subscription-cancelled",
	source: "hutch.subscriptions",
	detailType: "SubscriptionCancelled",
	detailSchema: z.object({
		userId: z.string(),
		subscriptionId: z.string().optional(),
		reason: z.enum([
			"stripe_webhook",
			"user_initiated_trial",
			"user_initiated_paid_confirmed",
		]),
	}),
});
export type SubscriptionCancelledDetail = z.infer<typeof SubscriptionCancelledEvent.detailSchema>;

/** User-initiated cancel request. Published by `POST /account/cancel` and
 * by the deferred-cancellation EventBridge Scheduler when the
 * cancellation-effective-at instant arrives. Consumed by the
 * `cancel-subscription` Lambda which branches on the row's current status:
 *   - active     → Stripe PATCH cancel_at_period_end=true, create the
 *                  deferred-cancellation schedule, emit
 *                  `SubscriptionCancellationScheduledEvent`.
 *   - trialing   → delete the trial-end charge schedule, create the
 *                  deferred-cancellation schedule firing after trialEndsAt,
 *                  emit `SubscriptionCancellationScheduledEvent`.
 *   - pending_cancellation → final conversion. Emit
 *                  `SubscriptionCancelledEvent`. Hit either by the deferred
 *                  scheduler firing (paid + trial) or by a second user cancel.
 *   - cancelled  → noop. */
export const CancelSubscriptionCommand = defineEvent({
	name: "cancel-subscription-command",
	source: "hutch.subscriptions",
	detailType: "CancelSubscriptionCommand",
	detailSchema: z.object({
		userId: z.string(),
	}),
});
export type CancelSubscriptionDetail = z.infer<typeof CancelSubscriptionCommand.detailSchema>;

/** Irreversible fact: a cancel was scheduled for the user's
 * cancellation-effective-at instant. Published by the `cancel-subscription`
 * Lambda for the `active` and `trialing` branches; consumed by the
 * `handle-subscription-cancellation-scheduled` Lambda which writes
 * `status='pending_cancellation'` and `cancellationEffectiveAt` to the row.
 *
 * `subscriptionId` is present for paid (active) cancels and absent for trial
 * cancels — the same trial-vs-paid discriminator the rest of the chain uses.
 * `cancellationEffectiveAt` is the instant access flips from full to
 * read-only: `current_period_end` for paid, `trialEndsAt` for trial. */
export const SubscriptionCancellationScheduledEvent = defineEvent({
	name: "subscription-cancellation-scheduled",
	source: "hutch.subscriptions",
	detailType: "SubscriptionCancellationScheduled",
	detailSchema: z.object({
		userId: z.string(),
		subscriptionId: z.string().optional(),
		cancellationEffectiveAt: z.string(),
	}),
});
export type SubscriptionCancellationScheduledDetail = z.infer<
	typeof SubscriptionCancellationScheduledEvent.detailSchema
>;

/** Irreversible fact: a user reactivated a scheduled cancellation inside the
 * cancellation-effective-at window. Published by `POST /account/reactivate`
 * after the synchronous Stripe PATCH (paid) or upsertTrialing (trial) has
 * succeeded. No load-bearing handler today — the route does the row write
 * itself — but the event is wired so future analytics / email-reminder
 * handlers can subscribe without a schema change. */
export const SubscriptionReactivatedEvent = defineEvent({
	name: "subscription-reactivated",
	source: "hutch.subscriptions",
	detailType: "SubscriptionReactivated",
	detailSchema: z.object({
		userId: z.string(),
		subscriptionId: z.string().optional(),
	}),
});
export type SubscriptionReactivatedDetail = z.infer<
	typeof SubscriptionReactivatedEvent.detailSchema
>;

/** Trial-end auto-conversion request. Published by the EventBridge Scheduler
 * one-shot rule created at trial signup (fires at `trialEndsAt`). Consumed by
 * the `subscription-start-request` Lambda which reads the row and decides:
 *   - row missing or not `trialing` → noop (already converted or cancelled)
 *   - `trialing` + `customerId` → attempt Stripe `subscriptions.create` →
 *     `SubscriptionChargeSucceeded` / `SubscriptionChargeFailed`
 *   - `trialing` without `customerId` → publish `SubscriptionChargeFailed`
 *     immediately with reason `no_card_on_file`. */
export const SubscriptionStartRequestCommand = defineEvent({
	name: "subscription-start-request-command",
	source: "hutch.subscriptions",
	detailType: "SubscriptionStartRequestCommand",
	detailSchema: z.object({
		userId: z.string(),
	}),
});
export type SubscriptionStartRequestDetail = z.infer<
	typeof SubscriptionStartRequestCommand.detailSchema
>;

/** Irreversible fact: a Stripe subscription was successfully created on an
 * existing customer at trial-end. Published by the `subscription-start-request`
 * Lambda; consumed by the `subscription-charge-succeeded` Lambda which writes
 * `status='active'` via `upsertActive`. */
export const SubscriptionChargeSucceededEvent = defineEvent({
	name: "subscription-charge-succeeded",
	source: "hutch.subscriptions",
	detailType: "SubscriptionChargeSucceeded",
	detailSchema: z.object({
		userId: z.string(),
		subscriptionId: z.string(),
		customerId: z.string(),
	}),
});
export type SubscriptionChargeSucceededDetail = z.infer<
	typeof SubscriptionChargeSucceededEvent.detailSchema
>;

/** Irreversible fact: a trial-end charge attempt failed. Reasons:
 *   - `no_card_on_file` — the trialing row has no `customerId`, so no card
 *     can be charged. Typical for trials signed up via the no-card path.
 *   - `stripe_error` — Stripe rejected `subscriptions.create` (declined card,
 *     expired card, removed payment method, etc.).
 * Published by the `subscription-start-request` Lambda; consumed by the
 * `subscription-charge-failed` Lambda which dispatches
 * `CancelSubscriptionCommand`, closing the loop via the existing cancel chain. */
export const SubscriptionChargeFailedEvent = defineEvent({
	name: "subscription-charge-failed",
	source: "hutch.subscriptions",
	detailType: "SubscriptionChargeFailed",
	detailSchema: z.object({
		userId: z.string(),
		reason: z.enum(["no_card_on_file", "stripe_error"]),
	}),
});
export type SubscriptionChargeFailedDetail = z.infer<
	typeof SubscriptionChargeFailedEvent.detailSchema
>;

export type { HutchEvent, HutchCommand };
