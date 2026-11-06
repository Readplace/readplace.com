import assert from "node:assert/strict";
import { COUNT_GMAIL_CONNECTIONS_ENV } from "./count-gmail-connections.env";
import { STRIPE_WEBHOOK_RECEIVER_ENV } from "./stripe-webhook-receiver.env";
import { REWRITE_GMAIL_FILTER_ENV } from "./rewrite-gmail-filter.env";
import { GMAIL_NEWSLETTER_NOTICE_ENV } from "./gmail-newsletter-notice.env";
import { GMAIL_NEWSLETTER_MONITOR_ENV } from "./gmail-newsletter-monitor.env";
import { GMAIL_DISCOVERY_ENV } from "./gmail-discovery.env";
import { GMAIL_DISCOVERY_DLQ_ENV } from "./gmail-discovery-dlq.env";
import { NEWSLETTER_CATALOG_SUGGESTIONS_ENV } from "./newsletter-catalog-suggestions.env";
import { GMAIL_HISTORY_IMPORT_ENV } from "./gmail-history-import.env";
import { GMAIL_HISTORY_IMPORT_OUTCOMES_ENV } from "./gmail-history-import-outcomes.env";
import { GMAIL_MESSAGE_UPDATE_ENV } from "./gmail-message-update.env";
import { GMAIL_MARK_BACKFILL_ENV } from "./gmail-mark-backfill.env";
import { GMAIL_HISTORY_IMPORT_DLQ_ENV } from "./gmail-history-import-dlq.env";
import { HUTCH_HANDLER_ROOT_ENV, HUTCH_HANDLER_ENV } from "./lambda.env";
import { USER_DATA_JOBS_ENV } from "./user-data-jobs.env";
import { SEND_USER_DIGEST_ENV } from "./send-user-digest.env";
import { DIGEST_SCAN_ENV } from "./digest-scan.env";
import { MEDIA_RELEASE_ENV } from "./media-release.env";
import { SETTLE_MEDIA_FAILURE_ENV } from "./settle-media-failure.env";
import { RECORD_MEDIA_INSPECTION_ENV } from "./record-media-inspection.env";
import { SUBSCRIPTION_EVENTS_ENV } from "./subscription-events.env";
import { SEND_TRIAL_FEEDBACK_EMAIL_ENV } from "./send-trial-feedback-email.env";
import { SEND_FIRST_INBOX_EMAIL_NOTICE_ENV } from "./send-first-inbox-email-notice.env";
import { FORWARD_ANALYTICS_ENV } from "./forward-analytics.env";
import { EVALUATE_OAUTH_REFRESH_ENV } from "./evaluate-oauth-refresh.env";

const tuples = {
	COUNT_GMAIL_CONNECTIONS_ENV,
	STRIPE_WEBHOOK_RECEIVER_ENV,
	REWRITE_GMAIL_FILTER_ENV,
	GMAIL_NEWSLETTER_NOTICE_ENV,
	GMAIL_NEWSLETTER_MONITOR_ENV,
	GMAIL_DISCOVERY_ENV,
	GMAIL_DISCOVERY_DLQ_ENV,
	NEWSLETTER_CATALOG_SUGGESTIONS_ENV,
	GMAIL_HISTORY_IMPORT_ENV,
	GMAIL_HISTORY_IMPORT_OUTCOMES_ENV,
	GMAIL_MESSAGE_UPDATE_ENV,
	GMAIL_MARK_BACKFILL_ENV,
	GMAIL_HISTORY_IMPORT_DLQ_ENV,
	HUTCH_HANDLER_ROOT_ENV,
	HUTCH_HANDLER_ENV,
	USER_DATA_JOBS_ENV,
	SEND_USER_DIGEST_ENV,
	DIGEST_SCAN_ENV,
	MEDIA_RELEASE_ENV,
	SETTLE_MEDIA_FAILURE_ENV,
	RECORD_MEDIA_INSPECTION_ENV,
	SUBSCRIPTION_EVENTS_ENV,
	SEND_TRIAL_FEEDBACK_EMAIL_ENV,
	SEND_FIRST_INBOX_EMAIL_NOTICE_ENV,
	FORWARD_ANALYTICS_ENV,
	EVALUATE_OAUTH_REFRESH_ENV,
};

describe("Lambda environment tuples", () => {
	for (const [name, names] of Object.entries(tuples)) {
		it(`${name} names each variable once`, () => {
			assert.equal(new Set(names).size, names.length);
		});
	}
});
