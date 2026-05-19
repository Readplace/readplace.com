import { test } from "node:test";
import assert from "node:assert/strict";
import { runPdfSaveScenario } from "browser-extension-core/e2e";

const STAGING_URL = process.env.STAGING_URL;
const STAGING_TEST_EMAIL = process.env.STAGING_TEST_EMAIL;
const STAGING_TEST_PASSWORD = process.env.STAGING_TEST_PASSWORD;

/** Known-good small PDF from the production health canary
 * (src/packages/crawl-article/scripts/health-sources.ts:174). The canary keeps
 * this URL working for the real OCR pipeline; reusing it here means the
 * staging variant of the pdf-save-flow scenario fails for the same reasons
 * the canary fails, not for unrelated PDF-source rot. */
const STAGING_PDF_URL = "https://arxiv.org/pdf/1706.03762v7";
const STAGING_EXPECTED_TITLE_SUBSTRING = "Attention";

test("extension should save a PDF URL end-to-end against staging", async (t) => {
	if (!STAGING_URL || !STAGING_TEST_EMAIL || !STAGING_TEST_PASSWORD) {
		t.skip("STAGING_URL, STAGING_TEST_EMAIL, STAGING_TEST_PASSWORD must be set");
		return;
	}
	assert(STAGING_URL && STAGING_TEST_EMAIL && STAGING_TEST_PASSWORD);
	await runPdfSaveScenario({
		serverUrl: STAGING_URL,
		email: STAGING_TEST_EMAIL,
		password: STAGING_TEST_PASSWORD,
		pdfUrl: STAGING_PDF_URL,
		expectedTitleSubstring: STAGING_EXPECTED_TITLE_SUBSTRING,
		pollTimeoutMs: 120_000,
	});
});
