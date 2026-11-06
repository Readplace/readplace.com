import assert from "node:assert/strict";
import { CONFIRM_GMAIL_FORWARDING_ENV } from "./confirm-gmail-forwarding.env";
import { CRAWL_EMAIL_LINK_PREVIEW_ENV } from "./crawl-email-link-preview.env";
import { EXTRACT_EMAIL_LINKS_ENV } from "./extract-email-links.env";
import { GMAIL_IMPORT_COMPLETION_ENV } from "./gmail-import-completion.env";
import { INBOX_FAILURES_DLQ_ENV } from "./inbox-failures-dlq.env";
import { INGEST_GMAIL_IMPORT_ENV } from "./ingest-gmail-import.env";
import { INBOX_WEB_ENV } from "./lambda.env";
import { RECEIVE_EMAIL_ENV } from "./receive-email.env";
import { RECORD_EMAIL_LINKS_FILTERED_ENV } from "./record-email-links-filtered.env";
import { RECORD_LINK_QUEUED_ENV } from "./record-link-queued.env";

const tuples = {
	CONFIRM_GMAIL_FORWARDING_ENV,
	CRAWL_EMAIL_LINK_PREVIEW_ENV,
	EXTRACT_EMAIL_LINKS_ENV,
	GMAIL_IMPORT_COMPLETION_ENV,
	INBOX_FAILURES_DLQ_ENV,
	INGEST_GMAIL_IMPORT_ENV,
	INBOX_WEB_ENV,
	RECEIVE_EMAIL_ENV,
	RECORD_EMAIL_LINKS_FILTERED_ENV,
	RECORD_LINK_QUEUED_ENV,
};

describe("Lambda environment tuples", () => {
	for (const [name, names] of Object.entries(tuples)) {
		it(`${name} names each variable once`, () => {
			assert.equal(new Set(names).size, names.length);
		});
	}
});
