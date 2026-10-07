import assert from 'node:assert'
import { AsyncLocalStorage } from 'node:async_hooks'
import express from 'express'
import { z } from 'zod'
import { HutchLogger, consoleLogger, noopLogger } from '@packages/hutch-logger'
import {
	calculateReadTime,
	SaveProvenanceSchema,
	validateSaveableUrl,
	type ValidateSaveableUrl,
} from '@packages/domain/article'
import { type UserId, UserIdSchema } from '@packages/domain/user'
import {
	ForwardableSenderSchema,
	GMAIL_HISTORY_IMPORT_OUTCOME_COUNT,
	GMAIL_HISTORY_IMPORT_WINDOW_DAYS,
	GmailAccountEmailSchema,
	GmailHistoryImportCancelReasonSchema,
	GmailHistoryImportCountsSchema,
	GmailHistoryImportFailureReasonSchema,
	type GmailHistoryImportJobId,
	GmailHistoryImportMessageOutcomeSchema,
	GmailMessageIdSchema,
	gmailHistoryImportRawKey,
	settledCount,
} from '@packages/domain/gmail'
import { AliasNameSchema, type InboxAddress, InboxAddressSchema } from '@packages/domain/inbox'
import { NewsletterCatalogDocumentSchema, NewsletterCatalogRecordSchema } from '@packages/domain/newsletter-catalog'
import { DEFAULT_READLIST_SLUG, type ReadlistSlug, ReadlistSlugSchema, generateReadlistSlug } from '@packages/domain/readlist'
import {
	GMAIL_METADATA_SCOPE,
	GMAIL_READONLY_SCOPE,
	GMAIL_SCOPES,
	GMAIL_SETTINGS_SCOPE,
} from '@packages/provider-contracts/gmail-oauth'
import type { ReadNewsletterCatalog, WriteNewsletterCatalog } from '@packages/provider-contracts/newsletter-catalog'
import { initInMemoryGmailIntegration } from '@packages/test-fixtures/providers/gmail-integration'
import {
	type InMemoryNewsletterCatalog,
	initInMemoryNewsletterCatalog,
} from '@packages/test-fixtures/providers/newsletter-catalog'
import { initUpsertReadlist } from '@packages/save-article'
import { readNewsletterCatalogSeed } from '../runtime/domain/newsletter-catalog/newsletter-catalog-seed'
import { createTestApp } from '../runtime/test-app'
import {
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishRecrawlLinkInitiated,
	createFakePublishSaveAnonymousLink,
	createFakeSummaryProvider,
} from '@packages/test-fixtures'
import { getEnv, requireEnv } from "@packages/require-env"
import { READY_NONCE_ENV, readyProbePath } from "@packages/e2e-harness/ready-probe"
import { initRefreshArticleIfStale } from '@packages/finalize-article'
import { initResolveSaveIdentity, initSubmitFreshness, neverResolveWrapperTarget } from '@packages/save-article'
import type { ExtractPdf, IsBlockedAddress } from '@packages/crawl-article'
import { CRAWL_PERSONAS, initCrawlArticle, initCrawlFetch } from '@packages/crawl-article'
import { initExtractLinksFromPageUrl } from '@packages/extract-links-from-page'
import { initArticleSiteRules, initReadabilityParser, readabilityAdditions } from '@packages/article-parser'
import { initInMemoryRefreshArticleContent } from '@packages/test-fixtures/providers/events'
import { initInMemoryUpdateFetchTimestamp } from '@packages/test-fixtures/providers/events'
import { initInMemoryLinkSaved } from '@packages/test-fixtures/providers/events'
import { initInMemoryHostedCheckout } from '@packages/test-fixtures/providers/hosted-checkout'
import { CheckoutSessionIdSchema } from '@packages/test-fixtures/providers/hosted-checkout'
import { E2E_ADMIN_EMAIL } from './admin-extend-trial/admin-e2e-user'
import { renderChangelogBannerShell } from '@packages/web-shell'
import { E2E_CHANGELOG_BANNER, E2E_CHANGELOG_BANNER_HEADER } from './changelog-banner-fixture'

const PORT = Number(requireEnv('E2E_PORT'))
// Use 127.0.0.1 (not localhost) so the appOrigin passed into the test fixture
// matches the URL the extensions actually call — extension popups dial
// http://127.0.0.1:${PORT} (built with HUTCH_SERVER_URL=127.0.0.1:port), and a
// "localhost" appOrigin would cause CORS rejections on the OAuth/Siren routes.
const origin = `http://127.0.0.1:${PORT}`
const logger = HutchLogger.from(consoleLogger)

const logError = (message: string, error?: Error) => logger.error(message, error)
const logInfo = (message: string) => logger.info(message)
/** The e2e harness crawls its own fixtures, all served from the loopback server
 * below, so block nothing — otherwise the SSRF guard refuses every loopback
 * address, matching the relaxed string-level private-network check applied
 * during URL validation; the guard's lookup returns every resolved address, so
 * undici still reaches the 127.0.0.1 listener when localhost yields ::1 first. */
const e2eIsBlocked: IsBlockedAddress = () => false
const crawlFetch = initCrawlFetch({
	fetch: globalThis.fetch,
	personas: CRAWL_PERSONAS,
	isBlocked: e2eIsBlocked,
	logInfo,
	proxyUrl: undefined,
	fetchH2: async (url) => {
		throw new Error(`[e2e] h2 fallback disabled — primary fetch failed for ${url}`)
	},
	fetchCurl: async (url) => {
		throw new Error(`[e2e] curl fallback disabled — primary fetch failed for ${url}`)
	},
})
/** Deterministic PDF extractor for the e2e harness: emits the same synthetic
 * HTML the prod vision pipeline would produce for the bundled /e2e/fixtures/sample.pdf
 * fixture, so the pdf-save-flow e2e test can pin the extension's Siren contract
 * for "save a URL that returns application/pdf" without depending on DeepInfra
 * or the pdftoppm rasterizer. The marker title is what the test polls for to
 * detect that the crawler took the PDF-extraction branch and the selector
 * promoted the article to `ready`.
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
const { siteRules } = initArticleSiteRules({ crawlFetch, logError })
const crawlArticle = initCrawlArticle({ crawlFetch, siteRules, extractPdf, logError, logInfo })
const { parseArticle, parseHtml } = initReadabilityParser({ crawlArticle, siteRules, readabilityAdditions, logError })

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

let lastGmailInstant = 0
const gmailNow = () => {
	lastGmailInstant = Math.max(Date.now(), lastGmailInstant + 1)
	return new Date(lastGmailInstant)
}

const gmailIntegration = initInMemoryGmailIntegration({
	addresses: fixture.inboxAddress.inboxAddressStore,
	now: gmailNow,
	grant: {
		ok: true,
		grant: {
			refreshToken: 'e2e-refresh',
			accessToken: 'e2e-access',
			grantedScope: GMAIL_SCOPES,
		},
	},
})
const completeGmailDiscoveryOnStart = new Set<UserId>()
const recordGmailDiscoveryStart = gmailIntegration.bundle.publishStartGmailSenderDiscovery
gmailIntegration.bundle.publishStartGmailSenderDiscovery = async (detail) => {
	await recordGmailDiscoveryStart(detail)
	if (!completeGmailDiscoveryOnStart.delete(detail.userId)) return
	const discovery = await gmailIntegration.bundle.gmailDiscoveryStore.findDiscoveryByUserId(detail.userId)
	assert(discovery)
	assert(
		await gmailIntegration.bundle.gmailDiscoveryStore.claimPage({
			userId: detail.userId,
			generation: discovery.generation,
			page: discovery.page,
		}),
	)
	assert(
		await gmailIntegration.bundle.gmailDiscoveryStore.savePage({
			previous: discovery,
			senders: [],
			mode: discovery.mode,
			pageToken: undefined,
			historyId: discovery.historyId,
			state: 'complete',
			scannedMessages: 0,
			estimatedTotalMessages: discovery.estimatedTotalMessages,
			oldestScannedAt: discovery.oldestScannedAt,
		}),
	)
}
const GmailImportOutcomeCountsSchema = GmailHistoryImportCountsSchema.omit({ listed: true }).partial()
const completeGmailImportOnStart = new Map<UserId, z.infer<typeof GmailImportOutcomeCountsSchema>>()
const recordGmailImportStart = gmailIntegration.bundle.publishStartGmailHistoryImport
gmailIntegration.bundle.publishStartGmailHistoryImport = async (detail) => {
	await recordGmailImportStart(detail)
	const outcomeCounts = completeGmailImportOnStart.get(detail.userId)
	if (outcomeCounts === undefined) return
	await completeGmailImport({ ...detail, outcomeCounts })
}

async function completeGmailImport(input: {
	userId: UserId
	jobId: GmailHistoryImportJobId
	generation: string
	outcomeCounts: z.infer<typeof GmailImportOutcomeCountsSchema>
}): Promise<void> {
	const imports = gmailIntegration.bundle.gmailHistoryImportStore
	const { userId, jobId, generation } = input
	const now = gmailNow()
	assert(await imports.claimPage({ userId, jobId, generation, page: 0, now }))
	const outcomes = GmailHistoryImportMessageOutcomeSchema.options.flatMap((outcome) =>
		Array.from({ length: input.outcomeCounts[GMAIL_HISTORY_IMPORT_OUTCOME_COUNT[outcome]] ?? 0 }, () => outcome),
	)
	const messages = outcomes.map((outcome, index) => ({ outcome, gmailMessageId: GmailMessageIdSchema.parse(`e2e${index}`) }))
	const fetched: typeof messages = []
	for (const message of messages) {
		const rawS3Key = gmailHistoryImportRawKey({ userId, jobId, gmailMessageId: message.gmailMessageId })
		const recorded = await imports.recordFetched({ userId, jobId, generation, gmailMessageId: message.gmailMessageId, rawS3Key, now })
		assert.notEqual(recorded, 'stale')
		if (recorded === 'recorded') fetched.push(message)
	}
	const claimed = await imports.findJob({ userId, jobId })
	assert(claimed)
	assert(await imports.savePage({ previous: claimed, pageToken: undefined, now }))
	for (const { gmailMessageId, outcome } of fetched) {
		assert.equal(await imports.recordOutcome({ userId, jobId, generation, gmailMessageId, outcome, now }), 'recorded')
	}
	assert(await imports.completeIfSettled({ userId, jobId, now }))
}

const CATALOG_NAMESPACE_COOKIE = 'e2e_catalog_ns'
const SHARED_CATALOG_NAMESPACE = 'shared'
const CatalogNamespaceSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)
const newsletterCatalogs = new Map<string, InMemoryNewsletterCatalog>()
const newsletterCatalogNamespace = new AsyncLocalStorage<string>()
const activeNewsletterCatalog = (): InMemoryNewsletterCatalog => {
	const namespace = newsletterCatalogNamespace.getStore()
	assert(namespace, 'every request runs inside the newsletter catalog namespace middleware')
	const existing = newsletterCatalogs.get(namespace)
	if (existing) return existing
	const created = initInMemoryNewsletterCatalog(undefined)
	newsletterCatalogs.set(namespace, created)
	return created
}
const readE2eNewsletterCatalog: ReadNewsletterCatalog = () => activeNewsletterCatalog().readCatalog()
const writeE2eNewsletterCatalog: WriteNewsletterCatalog = (input) => activeNewsletterCatalog().writeCatalog(input)

function catalogNamespaceOf(cookieHeader: string | undefined): string {
	const cookie = (cookieHeader ?? '')
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${CATALOG_NAMESPACE_COOKIE}=`))
	if (cookie === undefined) return SHARED_CATALOG_NAMESPACE
	return cookie.slice(CATALOG_NAMESPACE_COOKIE.length + 1)
}

let seededReadlistAt = 0
const upsertE2eReadlist = initUpsertReadlist({
	listReadlistDefinitions: fixture.articleStore.listReadlistDefinitions,
	createReadlistDefinition: fixture.articleStore.createReadlistDefinition,
	generateReadlistSlug,
	now: () => {
		seededReadlistAt = Math.max(Date.now(), seededReadlistAt + 1)
		return new Date(seededReadlistAt)
	},
})

async function seedReadlistSlug(input: { userId: UserId; label: string }): Promise<ReadlistSlug> {
	const outcome = await upsertE2eReadlist({ userId: input.userId, name: input.label })
	assert(
		outcome.status === 'ok' || outcome.status === 'reserved-name',
		`seeded readlist "${input.label}" could not be created: ${outcome.status}`,
	)
	return outcome.readlist.slug
}

// E2E exercises the HTMX polling UI end-to-end, so opt the summary fake into
// transitioning pending → ready after a few reads. Unit/route tests use the
// default (stays pending) for deterministic HTML assertions.
const summary = createFakeSummaryProvider({ readyAfterReads: 3 })

// Wire real refresh stack with in-memory publishers so e2e exercises the
// event-driven refresh/update-timestamp paths (publishRefreshArticleContent
// and publishUpdateFetchTimestamp) end-to-end. In CI, swap to noopLogger so
// per-request "in-memory no-op" lines don't flood the build log; locally keep
// the consoleLogger so the lines are visible for debugging.
const eventLogger = getEnv('CI') === 'true' ? noopLogger : logger
const { publishRefreshArticleContent } = initInMemoryRefreshArticleContent({ logger: eventLogger })
const { publishUpdateFetchTimestamp } = initInMemoryUpdateFetchTimestamp({ logger: eventLogger })
const resolveSaveIdentity = initResolveSaveIdentity({
	validateUrl: e2eValidateSaveableUrl,
	findIdentityRow: fixture.articleStore.findIdentityRow,
	claimAlias: fixture.articleStore.claimAlias,
	resolveWrapperTarget: neverResolveWrapperTarget,
	now: () => new Date(),
})

const applyParseResult = createFakeApplyParseResult({
	articleStore: fixture.articleStore,
	articleCrawl: fixture.articleCrawl,
	parseArticle,
})

/** `inline` crawls and parses the article inside the save request so a
 * functional flow can assert on real crawled content; `submit` is the
 * production accept path, which only reads state and publishes, so a latency
 * measurement times the save rather than the crawler. */
const SAVE_PIPELINES = {
	inline: () => ({
		refreshArticleIfStale: initRefreshArticleIfStale({
			findArticleFreshness: fixture.articleStore.findArticleFreshness,
			findArticleCrawlStatus: fixture.articleCrawl.findArticleCrawlStatus,
			crawlArticle,
			parseHtml,
			publishRefreshArticleContent,
			publishUpdateFetchTimestamp,
			resolveCanonicalIdentity: async (url) => {
				const identity = await resolveSaveIdentity(url);
				assert(identity.status === "resolved", "The wrapper original could not be resolved");
				return { url: identity.url, originalUrl: identity.originalUrl };
			},
			now: () => new Date(),
			staleTtlMs: 0,
		}).refreshArticleIfStale,
		publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
	}),
	submit: () => ({
		refreshArticleIfStale: initSubmitFreshness({
			findArticleByUrl: fixture.articleStore.findArticleByUrl,
			findArticleCrawlStatus: fixture.articleCrawl.findArticleCrawlStatus,
			resolveSaveIdentity,
			publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
		}).refreshArticleIfStale,
		publishLinkSaved: initInMemoryLinkSaved({ logger: eventLogger }).publishLinkSaved,
	}),
}

const { refreshArticleIfStale, publishLinkSaved } =
	SAVE_PIPELINES[z.enum(["inline", "submit"]).parse(requireEnv("E2E_SAVE_PIPELINE"))]()

// E2E-specific Stripe checkout: generates local URLs so the browser can follow
// the redirect chain (POST /signup → local checkout → /auth/checkout/success)
// instead of hitting the unreachable https://checkout.stripe.test domain.
const e2eStripe = initInMemoryHostedCheckout({ checkoutBaseUrl: `${origin}/e2e/stripe-checkout`, now: () => new Date() })

const { app: readplaceApp, auth, email } = createTestApp({
	...fixture,
	// The default fixture allowlist is empty (fail-closed); the admin
	// extend-trial flow signs in as this address to pass the /admin gate.
	admin: {
		adminEmails: [E2E_ADMIN_EMAIL],
		recrawlServiceToken: fixture.admin.recrawlServiceToken,
	},
	hostedCheckout: e2eStripe,
	gmailIntegration: gmailIntegration.bundle,
	newsletterCatalog: {
		readNewsletterCatalog: readE2eNewsletterCatalog,
		writeNewsletterCatalog: writeE2eNewsletterCatalog,
		newsletterCatalogSeed: readNewsletterCatalogSeed(),
	},
	parser: { parseArticle, crawlArticle },
	events: {
		publishLinkSaved,
		publishLinkQueued: fixture.events.publishLinkQueued,
		publishLinkDequeued: fixture.events.publishLinkDequeued,
		publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
		publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
		publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
		publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
		publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
		publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
		publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
		publishRemoveMyContent: fixture.events.publishRemoveMyContent,
		publishUpdateFetchTimestamp,
		publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
		publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
		publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
		publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
	},
	freshness: { refreshArticleIfStale },
	summary,
	importSession: {
		importSessionStore: fixture.importSession.importSessionStore,
		extractLinksFromPageUrl: initExtractLinksFromPageUrl({ crawlFetch, validateUrl: e2eValidateSaveableUrl }),
	},
	shared: {
		/** Raw on purpose: createTestApp decorates shared.validateSaveableUrl with
		 * withUnwrapPreprocessing itself — wrapping here too would unwrap twice and
		 * diverge the e2e server from the production composition. */
		validateSaveableUrl: e2eValidateSaveableUrl,
		appOrigin: fixture.shared.appOrigin,
		staticBaseUrl: fixture.shared.staticBaseUrl,
		httpErrorMessageMapping: fixture.shared.httpErrorMessageMapping,
		logError,
		now: fixture.shared.now,
	},
})

const server = express()

// JSON body parser for /e2e/* fixture POSTs. Mounted on the outer router only;
// hutch's app keeps urlencoded for its own forms.
server.use('/e2e', express.json())

server.get(readyProbePath(requireEnv(READY_NONCE_ENV)), (_req, res) => {
	res.status(200).end()
})

server.use((req, res, next) => {
	const namespace = CatalogNamespaceSchema.safeParse(catalogNamespaceOf(req.headers.cookie))
	if (!namespace.success) {
		res.status(400).json({ error: `the ${CATALOG_NAMESPACE_COOKIE} cookie is not a valid namespace` })
		return
	}
	newsletterCatalogNamespace.run(namespace.data, next)
})

const CreateUserBody = z.object({
	email: z.email(),
	password: z.string().min(8),
	verified: z.boolean().default(false),
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
	const { verified, ...credentials } = parsed.data
	const created = await auth.createUser(credentials)
	if (verified && created.ok) await auth.markEmailVerified(credentials.email)
	res.status(201).json(created)
})

// Expose sent emails for E2E tests (password reset flow needs the reset token from email)
server.get('/e2e/sent-emails', (_req, res) => {
	res.json(email.getSentEmails())
})

// Seed a fully-crawled article with a fixed contentFetchedAt (and optional
// dated crawlVersions) so the crawl-bookmark visual test renders stable,
// deterministic date-time tab labels. Because the row already exists, /view
// short-circuits its first-visit crawl cascade (see handleViewArticle) and
// never overwrites the timestamp with wall-clock time — keeping the screenshot
// deterministic across runs.
const SeedCrawledArticleBody = z.object({
	url: z.string(),
	title: z.string(),
	content: z.string(),
	contentFetchedAt: z.string(),
	crawlVersions: z
		.array(z.object({ crawledAtMinute: z.string(), authorUserId: UserIdSchema.optional() }))
		.default([]),
	savedByUserId: UserIdSchema.optional(),
	wordCount: z.number().int().positive().default(500),
	siteName: z.string().optional(),
	savedAt: z.string().optional(),
	provenance: SaveProvenanceSchema.default({ kind: 'web' }),
	excerpt: z.string().default('Seeded for the crawl-bookmark visual test.'),
	generatedSummary: z.object({ summary: z.string(), excerpt: z.string() }).optional(),
})
server.post('/e2e/seed-crawled-article', async (req, res) => {
	const parsed = SeedCrawledArticleBody.safeParse(req.body)
	if (!parsed.success) {
		res.status(400).json({ error: parsed.error.flatten() })
		return
	}
	const {
		url,
		title,
		content,
		contentFetchedAt,
		crawlVersions,
		savedByUserId,
		wordCount,
		siteName,
		savedAt,
		provenance,
		excerpt,
		generatedSummary,
	} = parsed.data
	const hostname = new URL(url).hostname
	const metadata = {
		title,
		siteName: siteName ?? hostname,
		excerpt,
		wordCount,
	}
	const estimatedReadTime = calculateReadTime(wordCount)
	await fixture.articleStore.saveArticleGlobally({
		url,
		metadata,
		estimatedReadTime,
		savedAt: new Date(savedAt ?? contentFetchedAt),
	})
	const saved = savedByUserId
		? (
				await fixture.articleStore.saveArticle({
					userId: savedByUserId,
					url,
					metadata,
					estimatedReadTime,
					provenance,
					savedAt: await fixture.articleStore.allocateSavedAt({ userId: savedByUserId }),
				})
			).saved
		: undefined
	await fixture.articleStore.writeContent({ url, content })
	await fixture.articleCrawl.markCrawlReady({ url })
	if (generatedSummary) summary.markSummaryReady({ url, ...generatedSummary })
	await fixture.articleStore.setContentFetchedAt({ url, at: contentFetchedAt })
	await fixture.articleStore.setCrawlVersions({
		url,
		versions: crawlVersions,
	})
	res.status(201).json({ ok: true, articleId: saved?.id.value })
})

const SeedRelatedArticlesBody = z.object({
	userId: UserIdSchema,
	sourceUrl: z.string(),
	related: z.array(z.object({ url: z.string(), reason: z.string() })).min(1),
	computedAt: z.string(),
})
server.post('/e2e/seed-related-articles', async (req, res) => {
	const parsed = SeedRelatedArticlesBody.safeParse(req.body)
	if (!parsed.success) {
		res.status(400).json({ error: parsed.error.flatten() })
		return
	}
	const { userId, sourceUrl, related, computedAt } = parsed.data
	const outcome = await fixture.relatedArticles.markRelatedArticlesReady({
		userId,
		url: sourceUrl,
		relatedArticles: related,
		inputTokens: 0,
		outputTokens: 0,
		at: new Date(computedAt),
	})
	if (outcome === 'superseded') {
		res.status(409).json({ error: 'relations already settled for this article' })
		return
	}
	res.status(201).json({ ok: true })
})

const SeedPastReadsBody = z.object({
	userId: UserIdSchema,
	sourceUrl: z.string(),
	pastReads: z.array(z.object({ url: z.string(), reason: z.string() })).min(1),
	computedAt: z.string(),
})
server.post('/e2e/seed-past-reads', async (req, res) => {
	const parsed = SeedPastReadsBody.safeParse(req.body)
	if (!parsed.success) {
		res.status(400).json({ error: parsed.error.flatten() })
		return
	}
	const { userId, sourceUrl, pastReads, computedAt } = parsed.data
	await fixture.pastReads.markPastReadsReady({
		userId,
		url: sourceUrl,
		pastReads,
		fingerprint: 'e2e-seeded',
		inputTokens: 0,
		outputTokens: 0,
		at: new Date(computedAt),
	})
	res.status(201).json({ ok: true })
})

const SeedInboxArticleQueuedBody = z.object({ userId: UserIdSchema })
server.post('/e2e/seed-inbox-article-queued', async (req, res) => {
	const parsed = SeedInboxArticleQueuedBody.safeParse(req.body)
	if (!parsed.success) {
		res.status(400).json({ error: parsed.error.flatten() })
		return
	}
	await fixture.onboardingSignals.recordInboxArticleQueued({ userId: parsed.data.userId })
	res.status(201).json({ ok: true })
})

const SeedInboxAddressesBody = z.object({
	userId: UserIdSchema,
	inboxes: z.array(z.object({ name: AliasNameSchema, readlist: ReadlistSlugSchema.optional() })).min(1),
})
server.post('/e2e/seed-inbox-addresses', async (req, res) => {
	const parsed = SeedInboxAddressesBody.safeParse(req.body)
	if (!parsed.success) {
		res.status(400).json({ error: parsed.error.flatten() })
		return
	}
	const { userId, inboxes } = parsed.data
	const { inboxAddressStore, inboxAddressDomain } = fixture.inboxAddress
	const addresses: string[] = []
	for (const inbox of inboxes) {
		const entry = await inboxAddressStore.createAddress({
			userId,
			domain: inboxAddressDomain,
			name: inbox.name,
			purpose: 'user-alias',
		})
		if (inbox.readlist !== undefined) {
			await inboxAddressStore.setAddressReadlist({ userId, address: entry.address, readlist: inbox.readlist })
		}
		addresses.push(entry.address)
	}
	res.status(201).json({ ok: true, addresses })
})

const SEEDED_GMAIL_ACCOUNT_EMAIL = GmailAccountEmailSchema.parse('reader@gmail.com')
const MISSING_MAPPING_DESTINATION = InboxAddressSchema.parse('gmail-000000@missing.invalid')
const DAY_MS = 24 * 60 * 60 * 1000

const GMAIL_SCOPE_GRANTS = {
	settings: GMAIL_SETTINGS_SCOPE,
	metadata: GMAIL_METADATA_SCOPE,
	readonly: GMAIL_READONLY_SCOPE,
} as const

const SeedGmailConnectionSchema = z.enum([
	'setup',
	'awaiting-confirmation',
	'confirm-failed',
	'confirm-exhausted',
	'connected',
	'revoked',
	'disconnecting',
])
type SeedGmailConnection = z.infer<typeof SeedGmailConnectionSchema>

const SEED_GMAIL_CONNECTION: Record<
	SeedGmailConnection,
	{ beforeSenders: (userId: UserId) => Promise<void>; afterSenders: (userId: UserId) => Promise<void> }
> = {
	setup: { beforeSenders: async () => {}, afterSenders: async () => {} },
	'awaiting-confirmation': { beforeSenders: async () => {}, afterSenders: async () => {} },
	'confirm-exhausted': { beforeSenders: async () => {}, afterSenders: async () => {} },
	'confirm-failed': {
		beforeSenders: (userId) =>
			gmailIntegration.bundle.gmailConnectionStore.recordConfirmError({
				userId,
				error: { reason: 'token-rejected', at: gmailNow().toISOString() },
			}),
		afterSenders: async () => {},
	},
	connected: {
		beforeSenders: (userId) => gmailIntegration.bundle.gmailConnectionStore.markForwardingConfirmed({ userId }),
		afterSenders: async () => {},
	},
	revoked: {
		beforeSenders: (userId) => gmailIntegration.bundle.gmailConnectionStore.markForwardingConfirmed({ userId }),
		afterSenders: (userId) => gmailIntegration.bundle.gmailConnectionStore.markRevoked({ userId, reason: 'invalid-grant' }),
	},
	disconnecting: {
		beforeSenders: (userId) => gmailIntegration.bundle.gmailConnectionStore.markForwardingConfirmed({ userId }),
		afterSenders: (userId) => gmailIntegration.bundle.gmailConnectionStore.markDisconnectRequested({ userId }),
	},
}

const SeedGmailFilterSchema = z.enum(['none', 'live', 'updating', 'failed-too-long', 'failed-rejected'])
type SeedGmailFilter = z.infer<typeof SeedGmailFilterSchema>

const SEED_GMAIL_FILTER_ERROR: Record<
	SeedGmailFilter,
	((input: { userId: UserId; forwardTo: InboxAddress; senderCount: number }) => Promise<void>) | undefined
> = {
	none: undefined,
	live: undefined,
	updating: undefined,
	'failed-too-long': ({ userId, forwardTo, senderCount }) =>
		gmailIntegration.bundle.gmailConnectionStore.recordFilterError({
			userId,
			error: {
				code: 'query-too-long',
				forwardTo,
				senderCount: senderCount + 1,
				senderCapacity: senderCount,
				at: gmailNow().toISOString(),
			},
		}),
	'failed-rejected': ({ userId }) =>
		gmailIntegration.bundle.gmailConnectionStore.recordFilterError({
			userId,
			error: { code: 'rejected', message: 'Filter rejected by Gmail', at: gmailNow().toISOString() },
		}),
}

const SeedGmailMappingBody = z.discriminatedUnion('destination', [
	z.object({
		destination: z.literal('readlist'),
		email: ForwardableSenderSchema,
		readlist: z.string().min(1),
		additionalReadlists: z.array(z.string().min(1)).default([]),
		pending: z.boolean().default(false),
	}),
	z.object({
		destination: z.literal('legacy-inbox'),
		email: ForwardableSenderSchema,
		readlist: z.string().min(1),
		inboxName: AliasNameSchema,
		pending: z.boolean().default(false),
	}),
	z.object({
		destination: z.literal('disabled'),
		email: ForwardableSenderSchema,
		readlist: z.string().min(1),
		pending: z.boolean().default(false),
	}),
	z.object({
		destination: z.literal('missing'),
		email: ForwardableSenderSchema,
		pending: z.boolean().default(false),
	}),
])
type SeedGmailMapping = z.infer<typeof SeedGmailMappingBody>

async function seedMappingDestination(input: { userId: UserId; mapping: SeedGmailMapping }): Promise<InboxAddress> {
	const { userId, mapping } = input
	if (mapping.destination === 'missing') return MISSING_MAPPING_DESTINATION
	const readlist = await seedReadlistSlug({ userId, label: mapping.readlist })
	if (mapping.destination === 'legacy-inbox') {
		const { inboxAddressStore, inboxAddressDomain } = fixture.inboxAddress
		const inbox = await inboxAddressStore.createAddress({
			userId,
			domain: inboxAddressDomain,
			name: mapping.inboxName,
			purpose: 'gmail-mapped',
		})
		await inboxAddressStore.setAddressReadlist({
			userId,
			address: inbox.address,
			readlist: readlist === DEFAULT_READLIST_SLUG ? undefined : readlist,
		})
		return inbox.address
	}
	const entry = await gmailIntegration.bundle.getOrCreateReadlistAddress({ userId, readlist })
	if (mapping.destination === 'disabled') {
		await fixture.inboxAddress.inboxAddressStore.disableAddress({ userId, address: entry.address })
	}
	return entry.address
}

const SeedGmailImportCommon = {
	sender: ForwardableSenderSchema,
	counts: GmailHistoryImportCountsSchema.partial().default({}),
	listingCompletedAt: z.iso.datetime().optional(),
}
const SeedGmailImportBody = z.union([
	z.object({ ...SeedGmailImportCommon, state: z.enum(['awaiting-permission', 'queued', 'running', 'complete']) }),
	z.object({ ...SeedGmailImportCommon, state: z.literal('failed'), failureReason: GmailHistoryImportFailureReasonSchema }),
	z.object({ ...SeedGmailImportCommon, state: z.literal('cancelled'), cancelReason: GmailHistoryImportCancelReasonSchema }),
])

const SeedGmailStateBody = z
	.object({
		userId: UserIdSchema,
		connection: SeedGmailConnectionSchema.default('connected'),
		grantedScopes: z
			.array(z.enum(['settings', 'metadata', 'readonly']))
			.default(['settings', 'metadata']),
		discoveredSenders: z.array(z.object({ email: ForwardableSenderSchema, name: z.string().optional() })).default([]),
		discoveryState: z.enum(['idle', 'running', 'complete', 'failed']).default('complete'),
		discoveryRequiresReconnect: z.boolean().default(false),
		discoveryMode: z.enum(['profile', 'full', 'history']).default('full'),
		discoveryScannedMessages: z.number().int().nonnegative().optional(),
		discoveryCheckedMessages: z.number().int().nonnegative().optional(),
		discoveryEstimatedTotalMessages: z.number().int().nonnegative().optional(),
		completeDiscoveryOnStart: z.boolean().default(false),
		filter: SeedGmailFilterSchema.default('live'),
		readlists: z.array(z.string().min(1)).default([]),
		senders: z
			.array(
				z.object({
					email: z.string(),
					place: z.enum(['filter', 'unsorted', 'mapped']),
					subject: z.string().optional(),
					name: AliasNameSchema.optional(),
				}),
			)
			.default([]),
		mappings: z.array(SeedGmailMappingBody).default([]),
		imports: z.array(SeedGmailImportBody).default([]),
		completeImportsOnStart: GmailImportOutcomeCountsSchema.optional(),
	})
	.superRefine((body, context) => {
		if (body.discoveryRequiresReconnect && body.discoveryState !== 'failed') {
			context.addIssue({ code: 'custom', path: ['discoveryRequiresReconnect'], message: 'only a failed discovery can require a reconnect' })
		}
		if (body.discoveryCheckedMessages === undefined) return
		if (body.discoveryState === 'idle') {
			context.addIssue({ code: 'custom', path: ['discoveryCheckedMessages'], message: 'an idle discovery has checked no messages' })
		}
		const scanned = body.discoveryScannedMessages ?? body.discoveredSenders.length
		if (body.discoveryCheckedMessages < scanned) {
			context.addIssue({
				code: 'custom',
				path: ['discoveryCheckedMessages'],
				message: 'the cumulative checked count includes the messages scanned by the seeded page',
			})
		}
	})
type SeedGmailState = z.infer<typeof SeedGmailStateBody>

async function seedGmailDiscovery(input: {
	body: SeedGmailState
	gatewayAddress: InboxAddress
}): Promise<void> {
	const { body, gatewayAddress } = input
	const { userId, discoveryState, discoveryMode, discoveredSenders } = body
	if (discoveryState === 'idle') return
	const { gmailDiscoveryStore } = gmailIntegration.bundle
	const scannedMessages = body.discoveryScannedMessages ?? discoveredSenders.length
	await gmailDiscoveryStore.startDiscovery({
		checkedMessageCount: (body.discoveryCheckedMessages ?? scannedMessages) - scannedMessages,
		userId,
		accountEmail: SEEDED_GMAIL_ACCOUNT_EMAIL,
		gatewayAddress,
		generation: 'e2e',
		mode: discoveryMode,
		historyId: '100',
	})
	await gmailDiscoveryStore.claimPage({ userId, generation: 'e2e', page: 0 })
	const previous = await gmailDiscoveryStore.findDiscoveryByUserId(userId)
	assert(previous)
	const pageState = discoveryState === 'complete' ? 'complete' : 'running'
	await gmailDiscoveryStore.savePage({
		previous,
		senders: discoveredSenders.map((entry) => ({ email: entry.email, name: entry.name })),
		mode: discoveryMode,
		pageToken: pageState === 'running' ? 'e2e-next' : undefined,
		historyId: '100',
		state: pageState,
		scannedMessages,
		estimatedTotalMessages: body.discoveryEstimatedTotalMessages ?? discoveredSenders.length,
		oldestScannedAt: undefined,
	})
	if (discoveryState !== 'failed') return
	await gmailDiscoveryStore.failDiscovery({
		userId,
		generation: 'e2e',
		error: 'e2e seeded discovery failure',
		requiresReconnect: body.discoveryRequiresReconnect,
	})
}

async function seedLegacyGmailSenders(input: { userId: UserId; senders: SeedGmailState['senders'] }): Promise<number> {
	const { userId, senders } = input
	const { gmailSenderStore } = gmailIntegration.bundle
	const { inboxAddressStore, inboxAddressDomain } = fixture.inboxAddress
	for (const entry of senders) {
		const senderEmail = ForwardableSenderSchema.parse(entry.email)
		if (entry.place === 'unsorted') {
			await gmailSenderStore.recordSenderSeen({
				userId,
				senderEmail,
				subject: entry.subject ?? 'Newsletter',
			})
			continue
		}
		if (entry.subject !== undefined) {
			await gmailSenderStore.recordSenderSeen({ userId, senderEmail, subject: entry.subject })
		}
		if (entry.place === 'mapped') {
			assert(entry.name, 'a mapped sender must carry the inbox name to route it to')
			const inbox = await inboxAddressStore.createAddress({
				userId,
				domain: inboxAddressDomain,
				name: entry.name,
				purpose: 'gmail-mapped',
			})
			await gmailSenderStore.mapSenderToAddress({ userId, senderEmail, mappedAddresses: [inbox.address], deliveryMode: 'links' })
		}
		await gmailSenderStore.addSenderToFilter({ userId, senderEmail })
	}
	return senders.filter((entry) => entry.place !== 'unsorted').length
}

async function seedGmailMappings(input: {
	userId: UserId
	mappings: readonly SeedGmailMapping[]
}): Promise<InboxAddress[]> {
	const { userId, mappings } = input
	const { gmailSenderStore } = gmailIntegration.bundle
	const destinations: InboxAddress[] = []
	for (const mapping of mappings) {
		const mappedAddress = await seedMappingDestination({ userId, mapping })
		const additional = mapping.destination === 'readlist'
			? await Promise.all(mapping.additionalReadlists.map((label) => seedMappingDestination({ userId, mapping: { ...mapping, readlist: label } })))
			: []
		await gmailSenderStore.mapSenderToAddress({ userId, senderEmail: mapping.email, mappedAddresses: [mappedAddress, ...additional], deliveryMode: 'links' })
		await gmailSenderStore.addSenderToFilter({ userId, senderEmail: mapping.email })
		destinations.push(mappedAddress)
		destinations.push(...additional)
	}
	return destinations
}

async function seedGmailImports(input: {
	userId: UserId
	gatewayAddress: InboxAddress
	imports: SeedGmailState['imports']
}): Promise<void> {
	const { userId, gatewayAddress } = input
	const { gmailSenderStore, gmailHistoryImportStore, newGmailHistoryImportJobId } = gmailIntegration.bundle
	for (const entry of input.imports) {
		const sender = await gmailSenderStore.findSender({ userId, senderEmail: entry.sender })
		assert(sender?.mappedAddresses, `a seeded import for ${entry.sender} needs that sender mapped in the same seed`)
		const now = gmailNow()
		const counts = {
			imported: 0,
			alreadyImported: 0,
			skippedNoMessageId: 0,
			skippedSenderMismatch: 0,
			failed: 0,
			cancelled: 0,
			...entry.counts,
		}
		await gmailHistoryImportStore.createJob({
			userId,
			jobId: newGmailHistoryImportJobId(),
			senderEmail: entry.sender,
			destinationAddresses: sender.mappedAddresses,
			connection: { gatewayAddress, accountEmail: SEEDED_GMAIL_ACCOUNT_EMAIL },
			window:
				entry.state === 'awaiting-permission'
					? undefined
					: {
							start: new Date(now.getTime() - GMAIL_HISTORY_IMPORT_WINDOW_DAYS * DAY_MS).toISOString(),
							end: now.toISOString(),
						},
			generation: 'e2e-import',
			page: 0,
			pageToken: undefined,
			listingCompletedAt: entry.listingCompletedAt,
			state: entry.state,
			counts: { ...counts, listed: entry.counts.listed ?? settledCount({ ...counts, listed: 0 }) },
			failureReason: entry.state === 'failed' ? entry.failureReason : undefined,
			cancelReason: entry.state === 'cancelled' ? entry.cancelReason : undefined,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
			completedAt: entry.state === 'complete' ? now.toISOString() : undefined,
		})
	}
}

server.post('/e2e/seed-gmail-state', async (req, res) => {
	const parsed = SeedGmailStateBody.safeParse(req.body)
	if (!parsed.success) {
		res.status(400).json({ error: parsed.error.flatten() })
		return
	}
	const body = parsed.data
	const { userId, filter, mappings } = body
	const { gmailConnectionStore, gmailCredentialsStore, mintGatewayAddress } = gmailIntegration.bundle
	const connection = SEED_GMAIL_CONNECTION[body.connection]
	const gatewayAddress = await mintGatewayAddress({ userId })
	await gmailConnectionStore.createConnection({ userId, gatewayAddress })
	await gmailConnectionStore.recordAccountEmail({ userId, accountEmail: SEEDED_GMAIL_ACCOUNT_EMAIL })
	await gmailCredentialsStore.saveCredentials({
		userId,
		refreshToken: 'e2e-refresh',
		grantedScope: [...new Set(body.grantedScopes)].map((grant) => GMAIL_SCOPE_GRANTS[grant]).join(' '),
	})
	await seedGmailDiscovery({ body, gatewayAddress })
	if (body.completeDiscoveryOnStart) completeGmailDiscoveryOnStart.add(userId)
	completeGmailImportOnStart.delete(userId)
	if (body.completeImportsOnStart !== undefined) completeGmailImportOnStart.set(userId, body.completeImportsOnStart)
	await connection.beforeSenders(userId)
	for (const label of body.readlists) await seedReadlistSlug({ userId, label })
	const filtered = filter === 'updating' ? [] : mappings.filter((mapping) => !mapping.pending)
	const afterFilter = filter === 'updating' ? mappings : mappings.filter((mapping) => mapping.pending)
	const legacySenderCount = await seedLegacyGmailSenders({ userId, senders: body.senders })
	const filteredDestinations = await seedGmailMappings({ userId, mappings: filtered })
	const filterSenderCount = legacySenderCount + filtered.length
	if (filter !== 'none') await gmailConnectionStore.recordFilter({ userId, filterCount: 1, filterSenderCount })
	await seedGmailMappings({ userId, mappings: afterFilter })
	await SEED_GMAIL_FILTER_ERROR[filter]?.({
		userId,
		forwardTo: filteredDestinations[0] ?? gatewayAddress,
		senderCount: filterSenderCount,
	})
	await seedGmailImports({ userId, gatewayAddress, imports: body.imports })
	await connection.afterSenders(userId)
	res.status(201).json({ ok: true, gatewayAddress })
})

const SeedNewsletterCatalogBody = z.object({
	namespace: CatalogNamespaceSchema,
	records: z.array(NewsletterCatalogRecordSchema).default([]),
	mode: z.enum(['available', 'unavailable', 'conflict-next-write', 'fail-next-write']).default('available'),
})

const SEED_NEWSLETTER_CATALOG_MODE: Record<
	z.infer<typeof SeedNewsletterCatalogBody>['mode'],
	(catalog: InMemoryNewsletterCatalog) => void
> = {
	available: () => {},
	unavailable: (catalog) => catalog.failReads(true),
	'conflict-next-write': (catalog) => catalog.conflictNextWrite(),
	'fail-next-write': (catalog) => catalog.failNextWrite(),
}

server.post('/e2e/seed-newsletter-catalog', (req, res) => {
	const parsed = SeedNewsletterCatalogBody.safeParse(req.body)
	if (!parsed.success) {
		res.status(400).json({ error: parsed.error.flatten() })
		return
	}
	const { namespace, records, mode } = parsed.data
	const document = NewsletterCatalogDocumentSchema.safeParse({ version: 1, records })
	if (!document.success) {
		res.status(400).json({ error: document.error.flatten() })
		return
	}
	const catalog = initInMemoryNewsletterCatalog(document.data)
	SEED_NEWSLETTER_CATALOG_MODE[mode](catalog)
	newsletterCatalogs.set(namespace, catalog)
	res.status(201).json({ ok: true, namespace })
})

const SUBSCRIPTION_TRIAL_DEFAULT_OFFSET_MS = ((9 * 24 + 23) * 60 + 18) * 60 * 1000
const SUBSCRIPTION_CANCELLATION_DEFAULT_OFFSET_MS = 30 * 24 * 60 * 60 * 1000

const SeedSubscriptionStateBody = z.object({
	userId: UserIdSchema,
	state: z.enum(['trialing', 'cancellation-scheduled', 'inactive']),
	at: z.string().optional(),
})
server.post('/e2e/seed-subscription-state', async (req, res) => {
	const parsed = SeedSubscriptionStateBody.safeParse(req.body)
	if (!parsed.success) {
		res.status(400).json({ error: parsed.error.flatten() })
		return
	}
	const { userId, state, at } = parsed.data
	if (state === 'trialing') {
		const trialEndsAt = at ?? new Date(fixture.shared.now().getTime() + SUBSCRIPTION_TRIAL_DEFAULT_OFFSET_MS).toISOString()
		await fixture.subscriptionProviders.upsertTrialing({ userId, trialEndsAt })
	}
	if (state === 'cancellation-scheduled' || state === 'inactive') {
		await fixture.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: `e2e-sub-${userId}`,
			customerId: `e2e-cus-${userId}`,
			plan: 'yearly',
		})
	}
	if (state === 'cancellation-scheduled') {
		const cancellationEffectiveAt = at ?? new Date(fixture.shared.now().getTime() + SUBSCRIPTION_CANCELLATION_DEFAULT_OFFSET_MS).toISOString()
		await fixture.subscriptionProviders.markPendingCancellation({ userId, cancellationEffectiveAt })
	}
	if (state === 'inactive') {
		await fixture.subscriptionProviders.markCancelledByUserId({ userId })
	}
	res.status(201).json({ ok: true })
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

/** Minimal valid PDF (single empty page, ~300 bytes). The extractor stub above
 * never parses these bytes — it short-circuits to deterministic HTML. The
 * fixture's only job is to make the upstream HTTP response Content-Type and
 * magic bytes match `application/pdf` so the crawler dispatches to the PDF
 * extraction branch. */
const E2E_SAMPLE_PDF = Buffer.from(
	'%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000099 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n149\n%%EOF\n',
	'utf-8',
)
server.get('/e2e/fixtures/sample.pdf', (_req, res) => {
	res.type('application/pdf').send(E2E_SAMPLE_PDF)
})

const E2E_LARGE_PDF = Buffer.concat([E2E_SAMPLE_PDF, Buffer.alloc(4 * 1024 * 1024, 0x20)])
server.get('/e2e/fixtures/large.pdf', (_req, res) => {
	res.type('application/pdf').send(E2E_LARGE_PDF)
})

const E2E_ONE_PIXEL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQtgoFAAFOALvvDzCqAAAAAElFTkSuQmCC',
	'base64',
)
server.get('/e2e/fixtures/image/:name.png', (_req, res) => {
	res.set('Access-Control-Allow-Origin', origin).type('image/png').send(E2E_ONE_PIXEL_PNG)
})

server.put(
	'/e2e/s3/:key',
	express.raw({ type: () => true, limit: 512 * 1024 * 1024 }),
	(req, res) => {
		fixture.pendingUpload.receiveUpload(req.params.key, req.body)
		res.status(200).end()
	},
)

server.get('/blog/changelog-banner', (req, res) => {
	if (!req.get(E2E_CHANGELOG_BANNER_HEADER)) {
		res.status(204).end()
		return
	}
	res.type('html').send(renderChangelogBannerShell({ banner: E2E_CHANGELOG_BANNER }))
})

server.use(readplaceApp)

// Graceful shutdown so V8 writes coverage data to NODE_V8_COVERAGE directory
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))

// Bind explicitly to 127.0.0.1 so the listening socket matches what the
// extension popup connects to (Firefox treats 127.0.0.1 and IPv6 ::1 as
// distinct origins; binding to 0.0.0.0 + IPv6 ::1 has surfaced flakes).
server.listen(PORT, '127.0.0.1').on('listening', () => {
	logger.info(`E2E server running on http://127.0.0.1:${PORT}`)
})
