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

/** Tier-0 PDF entry point. The extension uploads PDF bytes from the user's
 * browser context (their real session cookies + real TLS fingerprint pass
 * the origin's bot defenses) and the server stages them to S3 before
 * publishing this command. The downstream `save-link-raw-pdf` Lambda reads
 * the staged buffer and runs `extractPdf` directly — no second fetch, no
 * bot defenses to negotiate. */
export const SaveLinkRawPdfCommand = defineEvent({
	name: "save-link-raw-pdf-command",
	source: "hutch.api",
	detailType: "SaveLinkRawPdfCommand",
	detailSchema: z.object({
		url: z.string(),
		userId: z.string(),
		title: z.string().optional(),
	}),
});
export type SaveLinkRawPdfDetail = z.infer<typeof SaveLinkRawPdfCommand.detailSchema>;

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
 * Issued by the inbox extract-email-links Lambda (one per kept saveable
 * newsletter link) and — dormant, no runtime caller yet — by save-link's
 * effect dispatcher when the aggregate's `submitLink` or `requestRecrawl`
 * transitions fire. Consumed by save-link's `submit-link` Lambda, which
 * today handles only the authenticated URL shape (`userId` present,
 * `rawHtml` absent); the `rawHtml` tier-0 and anonymous /view shapes are
 * reserved for the hutch caller migration. Routes via EventBridge — no
 * dedicated SQS queue required at the publisher. */
export const SubmitLinkCommand = defineEvent({
	name: "submit-link-command",
	source: "hutch.api",
	detailType: "SubmitLinkCommand",
	detailSchema: z.union([
		/** 1. Structural on purpose — this package stays dependency-light, so the
		 *     consumer re-parses the payload with the domain's `SaveProvenanceSchema`
		 *     exactly as it re-parses `userId` with `UserIdSchema`.
		 *  2. Strict so a pre-provenance `{url, userId}` still in flight at deploy
		 *     fails loudly here instead of being read as an anonymous submission. */
		z.object({
			url: z.string(),
			userId: z.string(),
			provenance: z.looseObject({ kind: z.string() }), /* 1 */
			rawHtml: z.string().optional(),
		}),
		z.strictObject({ url: z.string(), rawHtml: z.string().optional() }), /* 2 */
	]),
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

/** Irreversible fact: an authenticated save reached its terminal accept state —
 * the per-user queue row was upserted — whatever the freshness action was
 * (`new`, `refreshed`, or a skip on an already-settled article). Published by
 * every save surface through `@packages/save-article`, so a duplicate save
 * emits it exactly like a first save.
 *
 * Distinct from {@link LinkSavedEvent}, which fires only when the canonical
 * content tier flips and carries the aggregate's canonical URL: it is silent on
 * duplicates and unusable as an "is this saved?" signal. `url` here is the URL
 * as submitted, *before* canonical-alias resolution, so a consumer keying on
 * the URL it submitted matches the fact it gets back.
 *
 * Consumed by the inbox's `record-link-queued` Lambda, which maintains the
 * per-user saved-link read model behind the Articles tab's Saved button. */
export const LinkQueuedEvent = defineEvent({
	name: "link-queued",
	source: "hutch.save-article",
	detailType: "LinkQueued",
	detailSchema: z.object({
		url: z.string(),
		userId: z.string(),
	}),
});
export type LinkQueuedDetail = z.infer<typeof LinkQueuedEvent.detailSchema>;

/** Irreversible fact: a save added an article to a reader's queue that was not
 * in it before. Narrower than {@link LinkQueuedEvent} on both axes: it is silent
 * on a re-save of an article the reader already had, and it is silent for the
 * save provenances that do not ask for resurfacing — today the import commit,
 * whose thousands-of-links burst is not worth an LLM call each.
 *
 * `url` is the canonical URL after alias resolution — the articles-table
 * partition key and the per-user row's sort key — where `LinkQueuedEvent`
 * deliberately carries the URL as submitted. A consumer that reaches for the
 * wrong one of the two reads a row that does not exist.
 *
 * Consumed by the `compute-related-articles` Lambda, which selects the reader's
 * earlier saves to resurface under this one. */
export const QueueEntryCreatedEvent = defineEvent({
	name: "queue-entry-created",
	source: "hutch.save-article",
	detailType: "QueueEntryCreated",
	detailSchema: z.object({
		url: z.string(),
		userId: z.string(),
	}),
});
export type QueueEntryCreatedDetail = z.infer<
	typeof QueueEntryCreatedEvent.detailSchema
>;

export const RelatedArticlesComputedEvent = defineEvent({
	name: "related-articles-computed",
	source: "hutch.save-link",
	detailType: "RelatedArticlesComputed",
	detailSchema: z.object({
		url: z.string(),
		userId: z.string(),
		outcome: z.enum(["ready", "skipped"]),
		relatedCount: z.number(),
		inputTokens: z.number(),
		outputTokens: z.number(),
	}),
});
export type RelatedArticlesComputedDetail = z.infer<
	typeof RelatedArticlesComputedEvent.detailSchema
>;

/** Irreversible fact: a `SubmitLinkCommand` exhausted its accept-phase retries
 * and dead-lettered, so the save never reached its terminal accept state.
 *
 * Only emitted for a command carrying a `userId` — the reserved anonymous
 * shapes have no per-user read model to correct, and the DLQ alarm remains the
 * failure surface for those. */
export const LinkQueueFailedEvent = defineEvent({
	name: "link-queue-failed",
	source: "hutch.save-link",
	detailType: "LinkQueueFailed",
	detailSchema: z.object({
		url: z.string(),
		userId: z.string(),
		reason: z.string(),
		receiveCount: z.number(),
	}),
});
export type LinkQueueFailedDetail = z.infer<typeof LinkQueueFailedEvent.detailSchema>;

/** Irreversible fact: a reader's per-user queue row was deleted, so the link is
 * no longer in their queue. The inverse of {@link LinkQueuedEvent}, and the fact
 * that lets a per-user read model of "is this saved?" stop reading saved.
 *
 * Marking an article read publishes nothing — a read article is still in the
 * queue — and account deletion publishes nothing either, since it drops each
 * consumer's whole partition directly.
 *
 * `url` is the deleted row's own key: the canonical URL after alias resolution,
 * not the URL a save was submitted with. The two differ only for a save of an
 * adopted terminal URL, so a consumer keyed on the submitted URL matches this
 * fact everywhere except that case — accepted rather than closed with a
 * second key, because no such stale row has been observed. */
export const LinkDequeuedEvent = defineEvent({
	name: "link-dequeued",
	source: "hutch.save-article",
	detailType: "LinkDequeued",
	detailSchema: z.object({
		url: z.string(),
		userId: z.string(),
	}),
});
export type LinkDequeuedDetail = z.infer<typeof LinkDequeuedEvent.detailSchema>;

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
		/* Extraction instant, stamped once by the emitter. The selector uses it as
		 * the crawl-version minute-id, so an SQS redelivery (e.g. a persist failure
		 * after the version was already recorded) re-copies to the same key and
		 * dedupes to a no-op instead of minting a duplicate version off a fresh
		 * now(). Optional so messages in flight across the deploy that added it —
		 * and the DLQ handler, which needs only url to terminalize — still parse;
		 * the selector falls back to now() when it is absent. */
		extractedAt: z.string().optional(),
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

/** A user asked for the crawl-version snapshot they authored at
 * `versionMinuteId` to be removed. Deletes that snapshot (iff they authored it)
 * and prunes it from the log; when it is the last snapshot they authored, their
 * tier-0 capture and its sidecar go too. If that leaves the canonical copy
 * derived from a source that no longer exists, the pipeline re-selects from
 * what remains, re-crawls for the savers still holding the URL, or — when
 * nothing and nobody remains — purges every stored object and tombstones the
 * row. The remover's own queue row is never touched. */
export const RemoveMyContentCommand = defineEvent({
	name: "remove-my-content-command",
	source: "hutch.api",
	detailType: "RemoveMyContentCommand",
	detailSchema: z.object({
		url: z.string(),
		userId: z.string(),
		versionMinuteId: z.string(),
	}),
});
export type RemoveMyContentDetail = z.infer<typeof RemoveMyContentCommand.detailSchema>;

/** Re-establish the canonical content from whatever tier sources remain after
 * a removal. Deliberately NOT a TierContentExtractedEvent: that event's
 * `userId` means "who saved" and would fire the saved!-notification chain at
 * the remover, and its consumer treats zero remaining sources as a retryable
 * race — which, mid-removal, it genuinely is (the publisher checked
 * remaining > 0 before emitting). */
export const ReselectAfterRemovalEvent = defineEvent({
	name: "reselect-after-removal",
	source: "hutch.save-link",
	detailType: "ReselectAfterRemoval",
	detailSchema: z.object({
		url: z.string(),
	}),
});
export type ReselectAfterRemovalDetail = z.infer<
	typeof ReselectAfterRemovalEvent.detailSchema
>;

export const RecrawlContentExtractedEvent = defineEvent({
	name: "recrawl-content-extracted",
	source: "hutch.save-link",
	detailType: "RecrawlContentExtracted",
	detailSchema: z.object({
		url: z.string(),
		/* See TierContentExtractedEvent.extractedAt — the same stable minute-id
		 * anchor, here keeping crawl-version recording idempotent across recrawl
		 * redeliveries. */
		extractedAt: z.string().optional(),
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
		 * and gate the parse. Required: every producer of this internal event
		 * must carry it (all consumers live in this repo). */
		bodyHash: z.string(),
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
 * in PENDING_HTML_BUCKET) using the same key derivation the publisher used.
 * Inlining the HTML in this detail
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
		 * RefreshContentExtractedEvent so the persister lands it on the
		 * freshness row, where the next refresh reads it back as the pre-parse
		 * gate's `previousBodyHash`. Required: every producer of this internal
		 * command must thread the hash through (all callers live in this repo). */
		bodyHash: z.string(),
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

export const DeleteAccountCommand = defineEvent({
	name: "delete-account-command",
	source: "hutch.api",
	detailType: "DeleteAccountCommand",
	detailSchema: z.object({
		userId: z.string(),
	}),
});
export type DeleteAccountDetail = z.infer<typeof DeleteAccountCommand.detailSchema>;

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

export const UpdateFetchTimestampCommand = defineEvent({
	name: "update-fetch-timestamp-command",
	source: "hutch.api",
	detailType: "UpdateFetchTimestampCommand",
	detailSchema: z.object({
		url: z.string(),
		contentFetchedAt: z.string(),
		bodyHash: z.string().optional(),
	}),
});
export type UpdateFetchTimestampDetail = z.infer<
	typeof UpdateFetchTimestampCommand.detailSchema
>;

/** Carries `userId` so handlers can update the row by primary key instead of
 * GSI-querying on `subscriptionId`. Emitted by the
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
			"stripe_payment_failure",
			"user_initiated_trial",
			"user_initiated_paid_confirmed",
			"trial_expired_no_card",
			"trial_expired_charge_failed",
		]),
	}),
});
export type SubscriptionCancelledDetail = z.infer<typeof SubscriptionCancelledEvent.detailSchema>;

/** Cancel request. Published by `POST /account/cancel` (no `reason` — the
 * cancel-subscription Lambda derives the user-initiated variant), by the
 * `subscription-charge-failed` Lambda with a trial-expiry `reason`, and by
 * the deferred-cancellation EventBridge Scheduler when the
 * cancellation-effective-at instant arrives (echoing the `reason` its
 * creating branch carried, if any). Consumed by the
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
		reason: z
			.enum(["trial_expired_no_card", "trial_expired_charge_failed"])
			.optional(),
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
		plan: z.enum(["monthly", "yearly", "triennial"]).optional(),
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

/** Subscription-lifecycle email request carrying the email kinds that share
 * one Lambda (`send-trial-feedback-email`). Every kind's handler re-reads the
 * subscription row and re-checks the condition that justified the send before
 * sending, so a state change between scheduling and delivery cancels the email
 * rather than sending a false one. Absent `kind` means feedback for backward
 * compatibility with in-flight schedules whose Input is `{userId}` only. */
export const SendTrialFeedbackEmailCommand = defineEvent({
	name: "send-trial-feedback-email-command",
	source: "hutch.subscriptions",
	detailType: "SendTrialFeedbackEmailCommand",
	detailSchema: z.object({
		userId: z.string(),
		kind: z
			.enum(["feedback", "reminder", "charge_reminder", "payment_failed", "automation_saves_held"])
			.optional(),
		chargeAt: z.string().optional(),
		receivedAtMessageId: z.string().optional(),
		inboxAddress: z.string().optional(),
	}),
});
export type SendTrialFeedbackEmailDetail = z.infer<
	typeof SendTrialFeedbackEmailCommand.detailSchema
>;

export const SendFirstInboxEmailNoticeCommand = defineEvent({
	name: "send-first-inbox-email-notice-command",
	source: "hutch.inbox",
	detailType: "SendFirstInboxEmailNoticeCommand",
	detailSchema: z.object({
		userId: z.string(),
		receivedAtMessageId: z.string(),
		inboxAddress: z.string(),
	}),
});
export type SendFirstInboxEmailNoticeDetail = z.infer<
	typeof SendFirstInboxEmailNoticeCommand.detailSchema
>;

/** Global, per-URL fact: an article's clean reader view reached the successful
 * terminal state (crawl ready AND summary ready/skipped). Published by the
 * save-link effect dispatcher when `markSummaryReady` / `markSummarySkipped`
 * fire, and only on the transition into that state — a re-summarise of an
 * already-succeeded article is not a new fact.
 *
 * `succeededAt` is the domain persist-moment for *both* axes completing. It is
 * NOT the instant the reader became usable: the reader renders the body as soon
 * as the crawl axis is ready, so a user can read an entire article — and stamp a
 * `viewedAt` — while the summary is still generating. Anything asking "was the
 * article unavailable while they were looking at it?" must use the article's
 * `readerAvailableAt` instead; `succeededAt` carries no such ordering guarantee.
 *
 * `hasSummary` is true only for ready summaries; a skipped summary still
 * succeeds the reader view but carries no summary to announce. The reader-ready
 * fan-out Lambda subscribes and queues a digest row for every saver of this URL
 * who had opened the reader. `contentSourceTier` is optional — a reserved slot a
 * "loaded with a more complete version" notification can use to distinguish
 * tiers — so consumers must tolerate its absence. */
export const ReaderViewLoadingSucceeded = defineEvent({
	name: "reader-view-loading-succeeded",
	source: "hutch.save-link",
	detailType: "ReaderViewLoadingSucceeded",
	detailSchema: z.object({
		url: z.string(),
		succeededAt: z.string(),
		hasSummary: z.boolean(),
		contentSourceTier: z.enum(["tier-0", "tier-1"]).optional(),
	}),
});
export type ReaderViewLoadingSucceededDetail = z.infer<
	typeof ReaderViewLoadingSucceeded.detailSchema
>;

/** Per-user command to (maybe) send one reader-ready digest email. Dispatched
 * by the `digest-scan` Lambda — one command per distinct user with at least one
 * queued reader-ready article — on each `rate(6 hours)` flush tick, via direct
 * SQS. The `send-user-digest` Lambda consumes it, re-checks every gate against
 * the live per-article row, claims the per-user cooldown, and sends a single
 * digest of every still-eligible article. Carries only `userId`: the reference
 * instant for each article is that article's own set-once `readerAvailableAt`. */
export const SendUserDigestCommand = defineCommand({
	detailSchema: z.object({
		userId: z.string(),
	}),
});
export type SendUserDigestDetail = z.infer<
	typeof SendUserDigestCommand.detailSchema
>;

/** Irreversible fact: a reader-ready email was sent to a user. The one email
 * batches every reader-ready URL that came due in the 6-hourly window, so `urls`
 * carries the whole set (was a single `url`). Published by the `send-user-digest`
 * Lambda after the email send and the per-article set-once `emailSentAt` stamps.
 * No load-bearing consumer today — wired so future analytics handlers can
 * subscribe without a schema change. */
export const ReaderReadyEmailSentEvent = defineEvent({
	name: "reader-ready-email-sent",
	source: "hutch.reader-ready",
	detailType: "ReaderReadyEmailSent",
	detailSchema: z.object({
		userId: z.string(),
		urls: z.array(z.string()),
		sentAt: z.string(),
	}),
});
export type ReaderReadyEmailSentDetail = z.infer<
	typeof ReaderReadyEmailSentEvent.detailSchema
>;

/** Published once a forwarded email is parsed, sanitized, stored, and a row
 * written. The irreversible "an email arrived" fact. M2 has no consumer; M3
 * subscribes to extract links from the stored body without touching this
 * publisher (Open/Closed). */
export const EmailReceivedEvent = defineEvent({
	name: "email-received",
	source: "hutch.inbox",
	detailType: "EmailReceived",
	detailSchema: z.object({
		userId: z.string(),
		receivedAtMessageId: z.string(),
		recipientAddress: z.string(),
		/** "receive" saves kept links to the reader's queue; a "backfill" replay
		 * re-derives preview rows only — historical mail must never mass-save. */
		origin: z.enum(["receive", "backfill"]),
	}),
});
export type EmailReceivedDetail = z.infer<typeof EmailReceivedEvent.detailSchema>;

/** One command per link found inside a received email, fanned out by the
 * extract-email-links consumer (mirroring how /queue fans each import URL into
 * its own SaveLinkCommand). Its consumer crawls a preview of the single URL
 * WITHOUT saving it to the reading queue. Per-link granularity gives SQS-native
 * concurrency, retry, and DLQ isolation — one dead link never re-runs extraction
 * or re-crawls its siblings. */
export const CrawlEmailLinkPreview = defineEvent({
	name: "crawl-email-link-preview",
	source: "hutch.inbox",
	detailType: "CrawlEmailLinkPreview",
	detailSchema: z.object({
		userId: z.string(),
		receivedAtMessageId: z.string(),
		ordinal: z.string(),
		url: z.string(),
	}),
});
export type CrawlEmailLinkPreviewDetail = z.infer<typeof CrawlEmailLinkPreview.detailSchema>;

export const ConfirmGmailForwardingCommand = defineEvent({
	name: "confirm-gmail-forwarding",
	source: "hutch.inbox",
	detailType: "ConfirmGmailForwarding",
	detailSchema: z.object({
		userId: z.string(),
		forwardingAddress: z.string(),
		verifyUrl: z.string(),
	}),
});
export type ConfirmGmailForwardingDetail = z.infer<
	typeof ConfirmGmailForwardingCommand.detailSchema
>;

export const GmailForwardingConfirmedEvent = defineEvent({
	name: "gmail-forwarding-confirmed",
	source: "hutch.inbox",
	detailType: "GmailForwardingConfirmed",
	detailSchema: z.object({
		userId: z.string(),
		forwardingAddress: z.string(),
	}),
});
export type GmailForwardingConfirmedDetail = z.infer<
	typeof GmailForwardingConfirmedEvent.detailSchema
>;

export const GmailForwardingConfirmFailedEvent = defineEvent({
	name: "gmail-forwarding-confirm-failed",
	source: "hutch.inbox",
	detailType: "GmailForwardingConfirmFailed",
	detailSchema: z.object({
		userId: z.string(),
		forwardingAddress: z.string(),
		reason: z.enum(["token-rejected", "not-confirmed", "invalid-url"]),
	}),
});
export type GmailForwardingConfirmFailedDetail = z.infer<
	typeof GmailForwardingConfirmFailedEvent.detailSchema
>;

export const RewriteGmailFilterCommand = defineEvent({
	name: "rewrite-gmail-filter",
	source: "hutch.app",
	detailType: "RewriteGmailFilter",
	detailSchema: z.object({
		userId: z.string(),
		reason: z.enum(["forwarding-confirmed", "sender-added", "sender-removed"]),
	}),
});
export type RewriteGmailFilterDetail = z.infer<typeof RewriteGmailFilterCommand.detailSchema>;

export const GmailFilterRewrittenEvent = defineEvent({
	name: "gmail-filter-rewritten",
	source: "hutch.app",
	detailType: "GmailFilterRewritten",
	detailSchema: z.object({
		userId: z.string(),
		filterId: z.string().optional(),
		senderCount: z.number(),
	}),
});
export type GmailFilterRewrittenDetail = z.infer<typeof GmailFilterRewrittenEvent.detailSchema>;

export const GmailFilterRewriteFailedEvent = defineEvent({
	name: "gmail-filter-rewrite-failed",
	source: "hutch.app",
	detailType: "GmailFilterRewriteFailed",
	detailSchema: z.object({
		userId: z.string(),
		reason: z.enum([
			"not-connected",
			"not-confirmed",
			"reauth-required",
			"query-too-long",
			"rejected",
		]),
	}),
});
export type GmailFilterRewriteFailedDetail = z.infer<
	typeof GmailFilterRewriteFailedEvent.detailSchema
>;

export const DisconnectGmailCommand = defineEvent({
	name: "disconnect-gmail",
	source: "hutch.app",
	detailType: "DisconnectGmail",
	detailSchema: z.object({ userId: z.string() }),
});
export type DisconnectGmailDetail = z.infer<typeof DisconnectGmailCommand.detailSchema>;

export const GmailDisconnectedEvent = defineEvent({
	name: "gmail-disconnected",
	source: "hutch.app",
	detailType: "GmailDisconnected",
	detailSchema: z.object({
		userId: z.string(),
		filterRemoved: z.boolean(),
		grantRevoked: z.boolean(),
	}),
});
export type GmailDisconnectedDetail = z.infer<typeof GmailDisconnectedEvent.detailSchema>;

export type { HutchEvent, HutchCommand };
