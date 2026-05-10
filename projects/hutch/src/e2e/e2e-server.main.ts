import assert from 'node:assert'
import express from 'express'
import { z } from 'zod'
import { HutchLogger, consoleLogger, noopLogger } from '@packages/hutch-logger'
import { createTestApp } from '../runtime/test-app'
import {
  createDefaultTestAppFixture,
  createFakeApplyParseResult,
  createFakePublishLinkSaved,
  createFakePublishRecrawlLinkInitiated,
  createFakePublishSaveAnonymousLink,
  createFakeSummaryProvider,
  initReadabilityParser,
} from '@packages/test-fixtures'
import { requireEnv } from '../runtime/require-env'
import { initRefreshArticleIfStale } from '@packages/test-fixtures/providers/article-freshness'
import { DEFAULT_CRAWL_HEADERS, initCrawlArticle, initCrawlFetch } from '@packages/crawl-article'
import { theInformationPreParser } from '@packages/test-fixtures/providers/article-parser'
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
const crawlFetch = initCrawlFetch({ fetch: globalThis.fetch, defaultHeaders: { ...DEFAULT_CRAWL_HEADERS } })
const crawlArticle = initCrawlArticle({ crawlFetch, logError })
const { parseArticle, parseHtml } = initReadabilityParser({ crawlArticle, sitePreParsers: [theInformationPreParser], logError })

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
    publishUpdateFetchTimestamp,
    publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
  },
  freshness: { refreshArticleIfStale },
  summary,
  shared: {
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
