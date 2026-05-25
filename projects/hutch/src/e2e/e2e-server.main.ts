import assert from 'node:assert'
import express from 'express'
import { z } from 'zod'
import { HutchLogger, consoleLogger, noopLogger } from '@packages/hutch-logger'
import { validateSaveableUrl, type ValidateSaveableUrl } from '@packages/domain/article'
import { createTestApp } from '../runtime/test-app'
import {
  createDefaultTestAppFixture,
  createFakeApplyParseResult,
  createFakePublishLinkSaved,
  createFakePublishRecrawlLinkInitiated,
  createFakePublishSaveAnonymousLink,
  createFakeSummaryProvider,
} from '@packages/test-fixtures'
import { requireEnv } from '../runtime/domain/require-env'
import { initRefreshArticleIfStale } from '@packages/test-fixtures/providers/article-freshness'
import type { ExtractPdf } from '@packages/crawl-article'
import { CRAWL_PERSONAS, initComprehensiveCrawl, initCrawlArticle, initCrawlFetch, initRedditPreprocessor, initSimpleCrawl } from '@packages/crawl-article'
import { initReadabilityParser, mediumPreParser, theInformationPreParser } from '@packages/article-parser'
import { initInMemoryRefreshArticleContent } from '@packages/test-fixtures/providers/events'
import { initInMemoryUpdateFetchTimestamp } from '@packages/test-fixtures/providers/events'
import { initInMemoryStripeCheckout } from '@packages/test-fixtures/providers/stripe-checkout'
import { CheckoutSessionIdSchema } from '@packages/test-fixtures/providers/stripe-checkout'

const PORT = Number(requireEnv('E2E_PORT'))
// Use 127.0.0.1 (not localhost) so the appOrigin passed into the test fixture
// matches the URL the extensions actually call — extension popups dial
// http://127.0.0.1:${PORT} (built with HUTCH_SERVER_URL=127.0.0.1:port), and a
// "localhost" appOrigin would cause CORS rejections on the OAuth/Siren routes.
const origin = `http://127.0.0.1:${PORT}`
const logger = HutchLogger.from(consoleLogger)

const logError = (message: string, error?: Error) => console.error(JSON.stringify({ level: "ERROR", timestamp: new Date().toISOString(), message, stack: error?.stack }))
const crawlFetch = initCrawlFetch({ fetch: globalThis.fetch, personas: CRAWL_PERSONAS })
/** Deterministic PDF extractor for the e2e harness: emits the same synthetic
 * HTML the prod vision pipeline would produce for the bundled /e2e/fixtures/sample.pdf
 * fixture, so the pdf-save-flow e2e test can pin the extension's Siren contract
 * for "save a URL that returns application/pdf" without depending on DeepInfra
 * or the pdftoppm rasterizer. The marker title is what the test polls for to
 * detect that ComprehensiveCrawl ran the PDF branch and the selector promoted
 * the article from `unsupported` (SimpleCrawl) to `ready`.
 *
 * The body needs to be long enough that Mozilla Readability classifies it as a
 * real article (the parser falls back to title = "Article from <hostname>" if
 * Readability returns null, which would leave the marker out of the title and
 * the e2e poll would never converge). Repeating the body paragraph clears the
 * character-threshold heuristic without making the synthetic HTML noisy. */
const E2E_PDF_TITLE = "READPLACE_E2E_PDF_FIXTURE"
const E2E_PDF_BODY = "Readplace e2e pdf fixture body — this string is asserted on by the pdf-save-flow scenario."
const E2E_PDF_BODY_PARAGRAPHS = Array.from({ length: 12 }, () => `<p>${E2E_PDF_BODY}</p>`).join("")
const extractPdf: ExtractPdf = async () => ({
  kind: "fetched",
  title: E2E_PDF_TITLE,
  html: `<!DOCTYPE html><html><head><title>${E2E_PDF_TITLE}</title></head><body><article><h1>${E2E_PDF_TITLE}</h1>${E2E_PDF_BODY_PARAGRAPHS}</article></body></html>`,
})
const preprocessUrl = initRedditPreprocessor({ fetch: globalThis.fetch, logError })
const simpleCrawl = initSimpleCrawl({ crawlFetch, preprocessUrl, logError })
const comprehensiveCrawl = initComprehensiveCrawl({ crawlFetch, preprocessUrl, extractPdf, logError })
const crawlArticle = initCrawlArticle({ simpleCrawl, comprehensiveCrawl })
const { parseArticle, parseHtml } = initReadabilityParser({ crawlArticle, sitePreParsers: [theInformationPreParser, mediumPreParser], logError })

/** E2E tests use localhost URLs because the test server IS localhost.
 * Skip private-network rejection so test articles can be saved and viewed. */
const E2eSaveableUrlBrand = z.string().brand<"SaveableUrl">()
const e2eValidateSaveableUrl: ValidateSaveableUrl = (value) => {
  const result = validateSaveableUrl(value)
  if (result.status === "SUCCESS") return result
  if (result.error.code !== "private_network") return result
  const trimmed = typeof value === "string" ? value.trim() : ""
  try {
    const parsed = new URL(trimmed)
    return { status: "SUCCESS", url: E2eSaveableUrlBrand.parse(parsed.toString()) }
  } catch {
    return result
  }
}

const fixture = createDefaultTestAppFixture(origin)
// E2E exercises the HTMX polling UI end-to-end, so opt the summary fake into
// transitioning pending → ready after a few reads. Unit/route tests use the
// default (stays pending) for deterministic HTML assertions.
const summary = createFakeSummaryProvider({ readyAfterReads: 3 })

// Wire real refresh stack with in-memory publishers so e2e exercises the
// event-driven refresh/update-timestamp paths (publishRefreshArticleContent
// and publishUpdateFetchTimestamp) end-to-end. In CI, swap to noopLogger so
// per-request "in-memory no-op" lines don't flood the build log; locally keep
// the consoleLogger so the lines are visible for debugging.
const eventLogger = process.env.CI === 'true' ? noopLogger : logger
const { publishRefreshArticleContent } = initInMemoryRefreshArticleContent({ logger: eventLogger })
const { publishUpdateFetchTimestamp } = initInMemoryUpdateFetchTimestamp({ logger: eventLogger })
const { refreshArticleIfStale } = initRefreshArticleIfStale({
  findArticleFreshness: fixture.articleStore.findArticleFreshness,
  findArticleCrawlStatus: fixture.articleCrawl.findArticleCrawlStatus,
  crawlArticle,
  parseHtml,
  publishRefreshArticleContent,
  publishUpdateFetchTimestamp,
  now: () => new Date(),
  staleTtlMs: 0,
})

const applyParseResult = createFakeApplyParseResult({
  articleStore: fixture.articleStore,
  articleCrawl: fixture.articleCrawl,
  parseArticle,
})

// E2E-specific Stripe checkout: generates local URLs so the browser can follow
// the redirect chain (POST /signup → local checkout → /auth/checkout/success)
// instead of hitting the unreachable https://checkout.stripe.test domain.
const e2eStripe = initInMemoryStripeCheckout({ checkoutBaseUrl: `${origin}/e2e/stripe-checkout`, now: () => new Date() })

const { app: hutchApp, auth, email } = createTestApp({
  ...fixture,
  stripe: e2eStripe,
  parser: { parseArticle, crawlArticle },
  events: {
    publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
    publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
    publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
    publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
    publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
    publishUpdateFetchTimestamp,
    publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
    publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
  },
  freshness: { refreshArticleIfStale },
  summary,
  shared: {
    validateSaveableUrl: e2eValidateSaveableUrl,
    appOrigin: fixture.shared.appOrigin,
    staticBaseUrl: fixture.shared.staticBaseUrl,
    httpErrorMessageMapping: fixture.shared.httpErrorMessageMapping,
    logError,
    logParseError: fixture.shared.logParseError,
    now: fixture.shared.now,
  },
})

const server = express()

// JSON body parser for /e2e/* fixture POSTs. Mounted on the outer router only;
// hutch's app keeps urlencoded for its own forms.
server.use('/e2e', express.json())

const CreateUserBody = z.object({
  email: z.email(),
  password: z.string().min(8),
})

// Test fixture: create a user out-of-band so extension e2e tests can spawn this
// server as a subprocess and seed login credentials over HTTP instead of
// reaching for `auth.createUser` in-process. The single legitimate way the
// extension can ask for a new test capability is by adding an endpoint here.
server.post('/e2e/users', async (req, res) => {
  const parsed = CreateUserBody.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() })
    return
  }
  await auth.createUser(parsed.data)
  res.status(201).json({ ok: true })
})

// Expose sent emails for E2E tests (password reset flow needs the reset token from email)
server.get('/e2e/sent-emails', (_req, res) => {
  res.json(email.getSentEmails())
})

// Simulated Stripe Checkout: marks the session as paid and redirects to the
// success URL (replacing {CHECKOUT_SESSION_ID} the same way real Stripe does).
server.get('/e2e/stripe-checkout/:id', (req, res) => {
  const sessionId = CheckoutSessionIdSchema.parse(req.params.id)
  e2eStripe.markPaid(sessionId)
  const next = req.query.next
  assert(typeof next === 'string', 'next query param required')
  const successUrl = next.replace('{CHECKOUT_SESSION_ID}', sessionId)
  res.redirect(303, successUrl)
})

// Deterministic crawl-failure fixture: any GET returns 500 so tests can exercise
// the reader-failed / summary-hidden flow against a URL that's guaranteed to
// fail regardless of network conditions.
server.get('/e2e/unfetchable', (_req, res) => {
  res.status(500).type('text/plain').send('e2e: intentional crawl failure')
})

/** Minimal valid PDF (single empty page, ~300 bytes). The extractor stub above
 * never parses these bytes — it short-circuits to deterministic HTML. The
 * fixture's only job is to make the upstream HTTP response Content-Type and
 * magic bytes match `application/pdf` so SimpleCrawl reports `unsupported` and
 * ComprehensiveCrawl takes the PDF branch (crawl-article.ts:190). */
const E2E_SAMPLE_PDF = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000099 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n149\n%%EOF\n',
  'utf-8',
)
server.get('/e2e/fixtures/sample.pdf', (_req, res) => {
  res.type('application/pdf').send(E2E_SAMPLE_PDF)
})

server.use(hutchApp)

// Graceful shutdown so V8 writes coverage data to NODE_V8_COVERAGE directory
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))

// Bind explicitly to 127.0.0.1 so the listening socket matches what the
// extension popup connects to (Firefox treats 127.0.0.1 and IPv6 ::1 as
// distinct origins; binding to 0.0.0.0 + IPv6 ::1 has surfaced flakes).
server.listen(PORT, '127.0.0.1', () => {
  logger.info(`E2E server running on http://127.0.0.1:${PORT}`)
})
