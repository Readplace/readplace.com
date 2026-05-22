import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runPdfSaveScenario } from "browser-extension-core/e2e";

const STAGING_URL = process.env.STAGING_URL;
const STAGING_TEST_EMAIL = process.env.STAGING_TEST_EMAIL;
const STAGING_TEST_PASSWORD = process.env.STAGING_TEST_PASSWORD;

/**
 * Each CI run gets its own runId so the PDF URL the test feeds into the
 * extension's save-article action is unique. Reusing a shared URL across runs
 * would let one broken run strand the row at summaryStatus=pending and brick
 * every subsequent run on the cached state — same failure mode as hutch's
 * queue-flow staging test (see projects/hutch/src/e2e/queue-flow/run.e2e-staging.ts).
 *
 * The /e2e/fixtures/pdf/:id.pdf route on hutch (server.ts) returns the same
 * fixture bytes for every :id — a deterministic single-page PDF whose `/Title`
 * metadata is "READPLACE_E2E_PDF_FIXTURE", which is what the OCR pipeline reads
 * back as the article title — so unique paths produce unique articles without
 * needing the staging server to generate a per-request PDF.
 */
const STAGING_EXPECTED_TITLE_SUBSTRING = "READPLACE_E2E_PDF_FIXTURE";

test("extension should save a PDF URL end-to-end against staging", async (t) => {
	if (!STAGING_URL || !STAGING_TEST_EMAIL || !STAGING_TEST_PASSWORD) {
		t.skip("STAGING_URL, STAGING_TEST_EMAIL, STAGING_TEST_PASSWORD must be set");
		return;
	}
	assert(STAGING_URL && STAGING_TEST_EMAIL && STAGING_TEST_PASSWORD);
	const runId = randomUUID();
	await runPdfSaveScenario({
		serverUrl: STAGING_URL,
		email: STAGING_TEST_EMAIL,
		password: STAGING_TEST_PASSWORD,
		pdfUrl: `${STAGING_URL}/e2e/fixtures/pdf/${runId}.pdf`,
		expectedTitleSubstring: STAGING_EXPECTED_TITLE_SUBSTRING,
		pollTimeoutMs: 120_000,
	});
});
