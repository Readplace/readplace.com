import assert from "node:assert/strict";
import { SAVE_LINK_FAILURES_DLQ_ENV } from "./save-link-failures-dlq.env";
import { SAVE_LINK_COMMAND_ENV } from "./save-link-command.env";
import { SUBMIT_LINK_ENV } from "./submit-link.env";
import { SAVE_EMAIL_ISSUE_COMMAND_ENV } from "./save-email-issue-command.env";
import { SAVE_LINK_RAW_HTML_COMMAND_ENV } from "./save-link-raw-html-command.env";
import { SAVE_ANONYMOUS_LINK_COMMAND_ENV } from "./save-anonymous-link-command.env";
import { SIMPLE_CRAWL_UNSUPPORTED_POLICY_ENV } from "./simple-crawl-unsupported-policy.env";
import { PDF_PAGE_LLM_CLEANUP_ENV } from "./pdf-page-llm-cleanup.env";
import { PDF_PAGE_HTML_CONVERT_ENV } from "./pdf-page-html-convert.env";
import { PDF_DOCUMENT_DIFF_REVIEW_ENV } from "./pdf-document-diff-review.env";
import { COMPREHENSIVE_CRAWL_COMMAND_ENV } from "./comprehensive-crawl-command.env";
import { SAVE_LINK_RAW_PDF_COMMAND_ENV } from "./save-link-raw-pdf-command.env";
import { STALE_CHECK_ENV } from "./stale-check.env";
import { SELECT_MOST_COMPLETE_CONTENT_ENV } from "./select-most-complete-content.env";
import { PDF_PAGE_OCR_ENV } from "./pdf-page-ocr.env";
import { RENDER_CRAWL_COMMAND_ENV, RENDER_CRAWL_COMMAND_ROOT_ENV } from "./render-crawl-command.env";
import { REMOVE_MY_CONTENT_COMMAND_ENV } from "./remove-my-content-command.env";
import { RESELECT_AFTER_REMOVAL_ENV } from "./reselect-after-removal.env";
import { GENERATE_SUMMARY_ENV } from "./generate-summary.env";
import { LINK_SAVED_ENV } from "./link-saved.env";
import { ANONYMOUS_LINK_SAVED_ENV } from "./anonymous-link-saved.env";
import { CANONICAL_CONTENT_CHANGED_ENV } from "./canonical-content-changed.env";
import { COMPUTE_RELATED_ARTICLES_ENV } from "./compute-related-articles.env";
import { FILTER_EMAIL_LINKS_ENV } from "./filter-email-links.env";
import { FILE_ARTICLE_INTO_READLIST_ENV } from "./file-article-into-readlist.env";
import { RECRAWL_LINK_INITIATED_ENV } from "./recrawl-link-initiated.env";
import { RECRAWL_CONTENT_EXTRACTED_ENV } from "./recrawl-content-extracted.env";
import { SUMMARY_GENERATED_ENV } from "./summary-generated.env";
import { SUMMARY_GENERATION_FAILED_ENV } from "./summary-generation-failed.env";
import { REFRESH_ARTICLE_CONTENT_ENV } from "./refresh-article-content.env";
import { REFRESH_CONTENT_EXTRACTED_ENV } from "./refresh-content-extracted.env";
import { UPDATE_FETCH_TIMESTAMP_ENV } from "./update-fetch-timestamp.env";

const tuples = {
	SAVE_LINK_FAILURES_DLQ_ENV,
	SAVE_LINK_COMMAND_ENV,
	SUBMIT_LINK_ENV,
	SAVE_EMAIL_ISSUE_COMMAND_ENV,
	SAVE_LINK_RAW_HTML_COMMAND_ENV,
	SAVE_ANONYMOUS_LINK_COMMAND_ENV,
	SIMPLE_CRAWL_UNSUPPORTED_POLICY_ENV,
	PDF_PAGE_LLM_CLEANUP_ENV,
	PDF_PAGE_HTML_CONVERT_ENV,
	PDF_DOCUMENT_DIFF_REVIEW_ENV,
	COMPREHENSIVE_CRAWL_COMMAND_ENV,
	SAVE_LINK_RAW_PDF_COMMAND_ENV,
	STALE_CHECK_ENV,
	SELECT_MOST_COMPLETE_CONTENT_ENV,
	PDF_PAGE_OCR_ENV,
	RENDER_CRAWL_COMMAND_ENV,
	RENDER_CRAWL_COMMAND_ROOT_ENV,
	REMOVE_MY_CONTENT_COMMAND_ENV,
	RESELECT_AFTER_REMOVAL_ENV,
	GENERATE_SUMMARY_ENV,
	LINK_SAVED_ENV,
	ANONYMOUS_LINK_SAVED_ENV,
	CANONICAL_CONTENT_CHANGED_ENV,
	COMPUTE_RELATED_ARTICLES_ENV,
	FILTER_EMAIL_LINKS_ENV,
	FILE_ARTICLE_INTO_READLIST_ENV,
	RECRAWL_LINK_INITIATED_ENV,
	RECRAWL_CONTENT_EXTRACTED_ENV,
	SUMMARY_GENERATED_ENV,
	SUMMARY_GENERATION_FAILED_ENV,
	REFRESH_ARTICLE_CONTENT_ENV,
	REFRESH_CONTENT_EXTRACTED_ENV,
	UPDATE_FETCH_TIMESTAMP_ENV,
};

describe("Lambda environment tuples", () => {
	for (const [name, names] of Object.entries(tuples)) {
		it(`${name} names each variable once`, () => {
			assert.equal(new Set(names).size, names.length);
		});
	}
});
