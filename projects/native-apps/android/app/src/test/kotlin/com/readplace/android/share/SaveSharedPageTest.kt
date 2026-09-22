package com.readplace.android.share

import com.readplace.android.RecordingServer
import com.readplace.android.RecordingServer.Stub
import com.readplace.android.core.AccessToken
import com.readplace.android.core.AppConfig
import com.readplace.android.core.CapturedPage
import com.readplace.android.core.HtmlCapturing
import com.readplace.android.core.OAuth
import com.readplace.android.core.OAuthTokens
import com.readplace.android.core.ReadplaceApi
import com.readplace.android.core.RefreshToken
import com.readplace.android.core.ServerMessage
import com.readplace.android.core.TokenKey
import com.readplace.android.core.TokenStorage
import com.readplace.android.core.TokenStore
import com.readplace.android.core.UnseenSave
import com.readplace.android.core.UploadJob
import com.readplace.android.core.UploadJobStore
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Cache
import okhttp3.CacheControl
import okhttp3.OkHttpClient
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.atomic.AtomicInteger
import javax.crypto.AEADBadTagException
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/**
 * End-to-end coverage of the share-save journey: [SaveSharedPage.run] drives the
 * real list → save → readlist decision tree through the production API, token and
 * upload-queue types, with the page capture faked by [FakeHtmlCaptor] and the
 * network by [RecordingServer].
 */
class SaveSharedPageTest {
	@get:Rule
	val server = RecordingServer()

	@get:Rule
	val temporaryFolder = TemporaryFolder()

	/** A [TokenStorage] holding its values in memory. Reads of a key listed in
	 * [unreadable] fail with the given error — the device condition (a keystore
	 * that cannot be decrypted) no plain JVM test could otherwise reproduce. */
	private class InMemoryTokenStorage(
		private val unreadable: Map<TokenKey, Throwable> = emptyMap(),
	) : TokenStorage {
		private val stored = mutableMapOf<TokenKey, String>()

		override fun readValue(key: TokenKey): Result<String?> {
			val failure = unreadable[key]
			if (failure != null) return Result.failure(failure)
			return Result.success(stored[key])
		}

		override fun setValue(key: TokenKey, value: String) {
			stored[key] = value
		}

		override fun removeValue(key: TokenKey) {
			stored.remove(key)
		}
	}

	/** A test double for [HtmlCapturing] that returns a canned [CapturedPage] and
	 * records the URLs it was asked to capture — no real WebView involved.
	 * [renderTakes] models a render that runs long. */
	private class FakeHtmlCaptor(
		private val page: CapturedPage,
		private val renderTakes: Duration = Duration.ZERO,
	) : HtmlCapturing {
		val capturedUrls = mutableListOf<String>()

		override suspend fun capture(url: String): CapturedPage {
			capturedUrls += url
			delay(renderTakes)
			return page
		}
	}

	private class MultipartPart(val name: String?, val filename: String?, val body: ByteArray) {
		val text: String get() = String(body, Charsets.UTF_8)
	}

	private fun loggedInStore(access: String = "access-1"): TokenStore {
		val store = TokenStore(InMemoryTokenStorage())
		store.save(OAuthTokens(AccessToken(access), RefreshToken("refresh-1")))
		return store
	}

	private fun TestScope.api(
		store: TokenStore,
		cache: Cache? = null,
		ioDispatcher: CoroutineDispatcher = StandardTestDispatcher(testScheduler),
	): ReadplaceApi =
		ReadplaceApi(
			baseUrl = server.baseUrl,
			client = OkHttpClient.Builder().followRedirects(false)
				.apply { if (cache != null) cache(cache) }
				.build(),
			oauth = OAuth(baseUrl = server.baseUrl, store = store, http = OkHttpClient(), nativeUserAgent = USER_AGENT),
			nativeUserAgent = USER_AGENT,
			ioDispatcher = ioDispatcher,
		)

	private fun TestScope.jobStore(container: File): UploadJobStore =
		UploadJobStore(filesRoot = container, io = StandardTestDispatcher(testScheduler))

	/** Every save shares the same shape: the readlist, and a URL-only save that
	 * answers 201. Anything else — including a content upload, which this journey
	 * never makes — lands in the 404 arm and fails loudly. */
	private fun serveReadlistAndSave(
		messagesJson: String? = null,
		extra: (RecordingServer.Record) -> Stub? = { null },
	) {
		server.handle { record ->
			extra(record) ?: when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" ->
					if (record.method == "POST") {
						Stub.json(201, Fixtures.article(id = "url-saved"))
					} else {
						Stub.json(200, Fixtures.collection(listOf(Fixtures.article(id = "a1")), messagesJson = messagesJson))
					}
				else -> Stub.json(404, "{}")
			}
		}
	}

	private fun TestScope.makeSaver(
		store: TokenStore,
		captor: HtmlCapturing,
		container: File,
		stillSavingAfter: Duration = 4.seconds,
		cache: Cache? = null,
		ioDispatcher: CoroutineDispatcher = StandardTestDispatcher(testScheduler),
	): SaveSharedPage =
		SaveSharedPage(
			store = store,
			api = api(store, cache = cache, ioDispatcher = ioDispatcher),
			captor = captor,
			jobs = jobStore(container),
			unseenSave = UnseenSave(container),
			clock = Clock.fixed(NOW, ZoneOffset.UTC),
			stillSavingAfter = stillSavingAfter,
		)

	private suspend fun awaitArrival(gate: RecordingServer.Gate) = withContext(Dispatchers.IO) { gate.awaitArrival() }

	private fun saveArticleActionJson(href: String): String =
		"""{ "name": "save-article", "href": "$href", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }] }"""

	/** A collection advertising a `save-article` at [saveArticleHref], optionally with
	 * the `save-content` action, so a test can move the URL-only save between reads and
	 * choose whether the rediscovered page still offers a home for the capture. */
	private fun movableCollection(saveArticleHref: String, withSaveContent: Boolean = true): String {
		val saveContent =
			if (withSaveContent) {
				""", { "name": "save-content", "href": "/queue/save-content", "method": "POST", "type": "multipart/form-data", "fields": [] }"""
			} else {
				""
			}
		return Fixtures.collection(listOf(Fixtures.article("a1")), actionsJson = saveArticleActionJson(saveArticleHref) + saveContent)
	}

	private fun cacheableCollection(saveArticleHref: String): Stub =
		Stub(
			200,
			headers = mapOf(
				"Content-Type" to AppConfig.SIREN_MEDIA_TYPE,
				"Cache-Control" to "private, max-age=3600",
				"Vary" to "Accept, Authorization",
			),
			body = movableCollection(saveArticleHref).toByteArray(Charsets.UTF_8),
		)

	private fun urlOnlyPosts(): List<RecordingServer.Record> =
		server.records("/queue").filter { it.method == "POST" }

	private fun TestScope.queuedJobs(container: File): List<UploadJob> =
		jobStore(container).loadAll(now = Instant.MAX)

	private fun assertUploadedNothing() {
		val uploads = server.records.filter { it.header("Content-Type")?.startsWith("multipart/") == true }
		assertEquals("the share target stages content locally; the app is what uploads it", 0, uploads.size)
	}

	private fun TestScope.stagedParts(job: UploadJob, container: File): List<MultipartPart> {
		val ready = job.state as? UploadJob.State.Ready ?: throw AssertionError("expected a ready job, got ${job.state}")
		return multipartParts(ready.contentType, jobStore(container).bytesFile(job).readBytes())
	}

	/** Splits a `multipart/form-data` body back into its parts, byte-preserving
	 * through ISO-8859-1 so a binary content part survives the round trip. */
	private fun multipartParts(contentType: String, body: ByteArray): List<MultipartPart> {
		val delimiter = "--${contentType.substringAfter("boundary=")}"
		val segments = String(body, Charsets.ISO_8859_1).split(delimiter).drop(1)
		return segments.filter { it != "--\r\n" }.map { segment ->
			val chunk = segment.removePrefix("\r\n")
			val headerEnd = chunk.indexOf("\r\n\r\n")
			val headers = chunk.substring(0, headerEnd)
			val content = chunk.substring(headerEnd + 4).removeSuffix("\r\n")
			MultipartPart(
				name = Regex("; name=\"([^\"]*)\"").find(headers)?.groupValues?.get(1),
				filename = Regex("; filename=\"([^\"]*)\"").find(headers)?.groupValues?.get(1),
				body = content.toByteArray(Charsets.ISO_8859_1),
			)
		}
	}

	private fun part(parts: List<MultipartPart>, name: String): MultipartPart? = parts.firstOrNull { it.name == name }

	private fun postedUrl(record: RecordingServer.Record): String? =
		Json.parseToJsonElement(String(record.body, Charsets.UTF_8)).jsonObject["url"]?.jsonPrimitive?.content

	private fun html(html: String = "<html>hi</html>", title: String? = "Captured"): CapturedPage =
		CapturedPage.Html(html = html, title = title)

	@Test
	fun `saves the link first then leaves the capture ready for the app`() = runTest {
		val store = loggedInStore(access = "access-1")
		val captor = FakeHtmlCaptor(page = html(html = "<html><body>hi</body></html>"))
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		val saver = makeSaver(store = store, captor = captor, container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals(listOf("https://example.com/post"), captor.capturedUrls)

		val saveRecords = urlOnlyPosts()
		assertEquals("the link is saved with one URL-only POST", 1, saveRecords.size)
		val saved = saveRecords.single()
		assertEquals("https://example.com/post", postedUrl(saved))
		assertEquals(
			"the share-target save must carry the Android client header so the server records onboarding step 2",
			AppConfig.CLIENT_ANDROID,
			saved.header("X-Readplace-Client"),
		)
		assertUploadedNothing()

		val job = queuedJobs(container).single()
		assertEquals("the app keys the upload on the link the reader saved", "https://example.com/post", job.url)
		assertEquals("the job is due the moment it is admitted, stamped by the injected clock", NOW, job.nextAttemptAt)
		assertEquals(NOW, job.createdAt)
		assertEquals(0, job.attempts)
		val parts = stagedParts(job, container)
		assertEquals("https://example.com/post", part(parts, "url")?.text)
		assertEquals("text/html", part(parts, "mediaType")?.text)
		assertEquals("Captured", part(parts, "title")?.text)
		val contentPart = part(parts, "content") ?: throw AssertionError("expected a content part")
		assertEquals("the content part needs a filename so the server treats it as a file", "content", contentPart.filename)
		assertEquals("<html><body>hi</body></html>", contentPart.text)
	}

	@Test
	fun `a shared link with browser-only characters saves and captures one normalized url`() = runTest {
		val store = loggedInStore()
		val captor = FakeHtmlCaptor(page = html())
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		val shared = ShareExtractor.extract(
			SharedItems(
				listOf(
					SharedItem(
						contentText = null,
						urls = emptyList(),
						texts = listOf("Read https://example.com/path_(a^b)|c. Then stop"),
						pdfs = emptyList(),
					),
				),
			),
		)
		val normalized = "https://example.com/path_(a%5Eb)%7Cc"
		assertEquals("extraction settles on the one normalized article", normalized, shared?.url)

		val saver = makeSaver(store = store, captor = captor, container = container)
		val outcome = saver.run(url = shared?.url, fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals("the capture keys on the normalized url", listOf(normalized), captor.capturedUrls)
		assertEquals("the link is saved under the normalized url", normalized, postedUrl(urlOnlyPosts().single()))
		assertEquals(
			"the staged content form carries the same normalized url",
			normalized,
			part(stagedParts(queuedJobs(container).single(), container), "url")?.text,
		)
		assertUploadedNothing()
	}

	@Test
	fun `readlists the job before it reports the link saved`() = runTest {
		val store = loggedInStore()
		val captor = FakeHtmlCaptor(page = html(), renderTakes = 200.milliseconds)
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		var statesWhenReported: List<UploadJob.State> = emptyList()
		val saver = makeSaver(store = store, captor = captor, container = container)
		val outcome = saver.run(
			url = "https://example.com/post",
			fallbackTitle = null,
			sharedPdf = null,
			onSaved = { statesWhenReported = queuedJobs(container).map { it.state } },
		)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals(
			"the job is on disk, and still owed a capture, at the moment the sheet is told the link is saved",
			listOf(UploadJob.State.CapturePending(detectedMediaType = null)),
			statesWhenReported,
		)
		assertUploadedNothing()
	}

	@Test
	fun `records the save for the app before it reports the link saved`() = runTest {
		// The app decides on return whether a deep-scrolled list is worth resetting
		// by this marker, so it must be on disk by the moment the sheet may close —
		// which is the moment the save is reported.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		var recordedWhenReported = false
		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html()), container = container)
		val outcome = saver.run(
			url = "https://example.com/post",
			fallbackTitle = null,
			sharedPdf = null,
			onSaved = { recordedWhenReported = UnseenSave(container).exists },
		)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertTrue(
			"the marker is on disk at the moment the sheet is told the link is saved, so leaving right away still refreshes the app",
			recordedWhenReported,
		)
	}

	@Test
	fun `marks the job ready once the capture is staged`() = runTest {
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html()), container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		val job = queuedJobs(container).single()
		assertEquals("<html>hi</html>", part(stagedParts(job, container), "content")?.text)
		assertUploadedNothing()
	}

	@Test
	fun `reports the link saved before the content is staged`() = runTest {
		// The sheet is told "Saved" the moment the link lands, with the capture
		// still running behind it.
		val store = loggedInStore()
		val captor = FakeHtmlCaptor(page = html(), renderTakes = 200.milliseconds)
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		var savePostsWhenReported = -1
		var readyWhenReported = true
		val saver = makeSaver(store = store, captor = captor, container = container)
		val outcome = saver.run(
			url = "https://example.com/post",
			fallbackTitle = null,
			sharedPdf = null,
			onSaved = {
				savePostsWhenReported = urlOnlyPosts().size
				readyWhenReported = queuedJobs(container).any { it.state == UploadJob.State.Ready(contentType = "text/html") }
			},
		)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals("the link is already on the server when the sheet is told 'Saved'", 1, savePostsWhenReported)
		assertFalse("the sheet does not wait for the capture before saying 'Saved'", readyWhenReported)
		val job = queuedJobs(container).single()
		assertEquals("<html>hi</html>", part(stagedParts(job, container), "content")?.text)
		assertUploadedNothing()
	}

	@Test
	fun `waits for a capture that outlasts the still-saving threshold`() = runTest {
		// The render ran past the point the sheet starts saying so. The journey
		// keeps waiting — the captor's own timeout is the only bound — so the
		// content is staged rather than abandoned.
		val store = loggedInStore()
		val captor = FakeHtmlCaptor(page = html(html = "<html>slow</html>", title = "Slow"), renderTakes = 300.milliseconds)
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		val saver = makeSaver(store = store, captor = captor, container = container, stillSavingAfter = 50.milliseconds)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		val job = queuedJobs(container).single()
		assertEquals("<html>slow</html>", part(stagedParts(job, container), "content")?.text)
		assertEquals("the link was saved exactly once, with no retry of any kind", 1, urlOnlyPosts().size)
		assertUploadedNothing()
	}

	@Test
	fun `signals still saving when the journey outlasts its threshold`() = runTest {
		val store = loggedInStore()
		val captor = FakeHtmlCaptor(page = html(html = "<html>slow</html>", title = "Slow"), renderTakes = 300.milliseconds)
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		var stillSaving = 0
		val saver = makeSaver(store = store, captor = captor, container = container, stillSavingAfter = 50.milliseconds)
		val outcome = saver.run(
			url = "https://example.com/post",
			fallbackTitle = null,
			sharedPdf = null,
			onStillSaving = { stillSaving += 1 },
		)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals("the reader is told the sheet is still working, once", 1, stillSaving)
		assertUploadedNothing()
	}

	@Test
	fun `says nothing about still saving when the journey settles first`() = runTest {
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		var stillSaving = 0
		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html()), container = container, stillSavingAfter = 30.seconds)
		val outcome = saver.run(
			url = "https://example.com/post",
			fallbackTitle = null,
			sharedPdf = null,
			onStillSaving = { stillSaving += 1 },
		)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals("a save that settles inside the threshold never says it is running long", 0, stillSaving)
		assertUploadedNothing()
	}

	@Test
	fun `speaks the server's confirmation from the save response`() = runTest {
		// The 201 carries what to tell the reader; the journey hands it to the
		// sheet at the moment it paints, and the outcome carries the same words —
		// so the copy changes server-side, with no Play Store release.
		val store = loggedInStore()
		val emptyCaptor = FakeHtmlCaptor(page = CapturedPage.Empty)
		val savedBody = Fixtures.article(
			id = "url-saved",
			messagesJson = """
				{ "type": "success", "content": { "type": "text/html", "body": "Article saved" } },
				{ "type": "success", "content": { "type": "text/html", "body": "Saved to your reading list" } },
				{ "type": "success", "content": { "type": "application/pdf", "body": "%PDF-" } }
			""",
		)
		serveReadlistAndSave(extra = { record ->
			if (record.path == "/queue" && record.method == "POST") Stub.json(201, savedBody) else null
		})

		var reported: List<ServerMessage> = emptyList()
		val saver = makeSaver(store = store, captor = emptyCaptor, container = temporaryFolder.newFolder("files"))
		val outcome = saver.run(
			url = "https://example.com/post",
			fallbackTitle = null,
			sharedPdf = null,
			onSaved = { reported = it },
		)

		assertEquals(
			"the sheet is handed the renderable confirmation, and only the renderable",
			listOf("Article saved", "Saved to your reading list"),
			reported.map { it.plainText },
		)
		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(reported), outcome)
		assertUploadedNothing()
	}

	@Test
	fun `stages the shared pdf bytes without rendering or refetching`() = runTest {
		// The share sheet delivered the PDF itself (a PDF viewer, the Files app).
		// The journey must stage those bytes directly — no WebView render, no
		// refetch of an origin that might block a cookie-less second request.
		val store = loggedInStore()
		val captor = FakeHtmlCaptor(page = html(html = "<html>never used</html>", title = "never used"))
		val container = temporaryFolder.newFolder("files")
		val pdfBytes = "%PDF-1.7\nshared pdf body".toByteArray(Charsets.UTF_8)
		serveReadlistAndSave()

		val saver = makeSaver(store = store, captor = captor, container = container)
		val outcome = saver.run(url = "https://example.com/paper.pdf", fallbackTitle = "Paper", sharedPdf = { pdfBytes })

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals("delivered bytes must not trigger a WebView render", emptyList<String>(), captor.capturedUrls)
		assertTrue("delivered bytes must not be refetched from the origin", server.records("/paper.pdf").isEmpty())

		val job = queuedJobs(container).single()
		val parts = stagedParts(job, container)
		assertEquals("https://example.com/paper.pdf", part(parts, "url")?.text)
		assertEquals("application/pdf", part(parts, "mediaType")?.text)
		assertEquals("Paper", part(parts, "title")?.text)
		assertArrayEquals("the shared PDF bytes must reach the app unaltered", pdfBytes, part(parts, "content")?.body)
		assertUploadedNothing()
	}

	@Test
	fun `stages the shared pdf without a title part when the share carried a blank name`() = runTest {
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		val pdfBytes = "%PDF-1.7\nunnamed".toByteArray(Charsets.UTF_8)
		serveReadlistAndSave()

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = CapturedPage.Empty), container = container)
		val outcome = saver.run(url = "https://example.com/paper.pdf", fallbackTitle = "", sharedPdf = { pdfBytes })

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		val parts = stagedParts(queuedJobs(container).single(), container)
		assertEquals("a blank title is no title", listOf("url", "mediaType", "content"), parts.map { it.name })
	}

	@Test
	fun `leaves the pdf the captor only detected for the app to fetch`() = runTest {
		// A shared URL the captor resolved to a PDF: the share target has no bytes
		// to stage, so it hands the app the media type and lets the app — which is
		// not running under the share sheet's memory budget — fetch them.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = CapturedPage.PdfDetected), container = container)
		val outcome = saver.run(url = "https://example.com/paper.pdf", fallbackTitle = "Paper", sharedPdf = null)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals(
			"the app is told what the captor learned, so it does not have to re-detect it",
			listOf(UploadJob.State.CapturePending(detectedMediaType = "application/pdf")),
			queuedJobs(container).map { it.state },
		)
		assertTrue("the share target must not spend its memory budget fetching the PDF", server.records("/paper.pdf").isEmpty())
		assertUploadedNothing()
	}

	@Test
	fun `ignores shared bytes without pdf magic`() = runTest {
		// Bytes the share sheet claimed were a PDF but that don't carry the `%PDF-`
		// magic header must not be staged; the journey falls back to the normal
		// capture path for the URL.
		val store = loggedInStore()
		val captor = FakeHtmlCaptor(page = html(html = "<html><body>hi</body></html>"))
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		val saver = makeSaver(store = store, captor = captor, container = container)
		val outcome = saver.run(
			url = "https://example.com/post",
			fallbackTitle = null,
			sharedPdf = { "not a pdf at all".toByteArray(Charsets.UTF_8) },
		)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals("junk shared bytes must fall back to the capture path", listOf("https://example.com/post"), captor.capturedUrls)
		val job = queuedJobs(container).single()
		assertEquals("the junk bytes must never be staged as a PDF", "text/html", part(stagedParts(job, container), "mediaType")?.text)
		assertUploadedNothing()
	}

	@Test
	fun `falls back to the capture when the shared pdf loads as nothing`() = runTest {
		val store = loggedInStore()
		val captor = FakeHtmlCaptor(page = html())
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		val saver = makeSaver(store = store, captor = captor, container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = { null })

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals(listOf("https://example.com/post"), captor.capturedUrls)
		val job = queuedJobs(container).single()
		assertEquals("text/html", part(stagedParts(job, container), "mediaType")?.text)
	}

	@Test
	fun `uses the shared title when the rendered page has none`() = runTest {
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html(title = null)), container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = "Shared title", sharedPdf = null)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		val job = queuedJobs(container).single()
		assertEquals("Shared title", job.title)
		assertEquals("Shared title", part(stagedParts(job, container), "title")?.text)
	}

	@Test
	fun `stages no title when neither the page nor the share carries one`() = runTest {
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html(title = "")), container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		val job = queuedJobs(container).single()
		assertNull(job.title)
		assertEquals(listOf("url", "mediaType", "content"), stagedParts(job, container).map { it.name })
	}

	@Test
	fun `leaves the job pending when the capture is empty`() = runTest {
		// The capture produced no HTML, so there is nothing to stage — the job
		// stays as it was admitted, for the app to capture on device.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = CapturedPage.Empty), container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = "Shared title", sharedPdf = null)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals(1, urlOnlyPosts().size)
		assertEquals(listOf(UploadJob.State.CapturePending(detectedMediaType = null)), queuedJobs(container).map { it.state })
		assertUploadedNothing()
	}

	@Test
	fun `leaves the job pending when the rendered page is blank`() = runTest {
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html(html = "")), container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		val job = queuedJobs(container).single()
		assertEquals(UploadJob.State.CapturePending(detectedMediaType = null), job.state)
		assertFalse("a blank page stages no body", jobStore(container).bytesFile(job).exists())
	}

	@Test
	fun `readlists nothing when the server advertises no content action`() = runTest {
		// The server offers the URL-only save but no `save-content`. There is
		// nowhere to send the capture, so nothing is queued for the app.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		val saveArticleOnly = """
			{ "name": "save-article", "href": "/queue", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }] }
		"""
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" ->
					if (record.method == "POST") {
						Stub.json(201, Fixtures.article(id = "url-saved"))
					} else {
						Stub.json(200, Fixtures.collection(listOf(Fixtures.article(id = "a1")), actionsJson = saveArticleOnly))
					}
				else -> Stub.json(404, "{}")
			}
		}

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html()), container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.Saved(emptyList()), outcome)
		assertEquals(emptyList<UploadJob>(), queuedJobs(container))
		assertUploadedNothing()
	}

	@Test
	fun `readlists nothing without a shared store`() = runTest {
		// A build whose shared file store cannot be resolved still saves the link;
		// only the enrichment upload is lost.
		val store = loggedInStore()
		serveReadlistAndSave()

		val saver = SaveSharedPage(
			store = store,
			api = api(store),
			captor = FakeHtmlCaptor(page = html()),
			jobs = null,
			unseenSave = null,
			clock = Clock.fixed(NOW, ZoneOffset.UTC),
		)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.Saved(emptyList()), outcome)
		assertEquals(1, urlOnlyPosts().size)
		assertUploadedNothing()
	}

	@Test
	fun `still reports the link saved when the readlist cannot be written`() = runTest {
		// The link is on the server before the readlist is touched; a readlist that
		// cannot admit or stage costs the enrichment upload and nothing else.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		File(container, "upload-queue").writeText("a file where the readlist directory should be")
		serveReadlistAndSave()

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html()), container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals(1, urlOnlyPosts().size)
		assertTrue("the save itself landed, so the app still refreshes on return", UnseenSave(container).exists)
		assertEquals(emptyList<UploadJob>(), queuedJobs(container))
		assertUploadedNothing()
	}

	@Test
	fun `still reports the link saved when the detected pdf cannot be recorded`() = runTest {
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		File(container, "upload-queue").writeText("a file where the readlist directory should be")
		serveReadlistAndSave()

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = CapturedPage.PdfDetected), container = container)
		val outcome = saver.run(url = "https://example.com/paper.pdf", fallbackTitle = "Paper", sharedPdf = null)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals(1, urlOnlyPosts().size)
		assertEquals(emptyList<UploadJob>(), queuedJobs(container))
	}

	@Test
	fun `refuses when the server refuses the save`() = runTest {
		// The server refuses the save with a message-only error (e.g. a locked
		// account). The journey must surface it as Refused so the shell shows the
		// server's message, and must readlist nothing for an article that never landed.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" ->
					if (record.method == "POST") {
						Stub.json(403, Fixtures.accountLockedError())
					} else {
						Stub.json(200, Fixtures.collection(listOf(Fixtures.article(id = "a1"))))
					}
				else -> Stub.json(404, "{}")
			}
		}

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html()), container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		val refused = outcome as? SaveSharedOutcome.Refused ?: throw AssertionError("expected Refused, got $outcome")
		assertEquals("text/html", refused.messages.single().content.type)
		assertTrue(
			"the refusal must carry the server's contact message verbatim",
			refused.messages.single().content.body.contains("readplace+verification@readplace.com"),
		)
		assertEquals("a refused save has no article to enrich", emptyList<UploadJob>(), queuedJobs(container))
		assertFalse(
			"a refused save must not make the app reset a deep-scrolled list for a link that never landed",
			UnseenSave(container).exists,
		)
		assertEquals(
			"a refusal is the server's answer, not a stale address: the save is not re-discovered and retried",
			1,
			urlOnlyPosts().size,
		)
		assertUploadedNothing()
	}

	@Test
	fun `re-discovers past the cache and retries once when the save action has moved`() = runTest {
		// A real disk cache warms with the collection behind the 303 entry redirect. The
		// first save is posted to the stale (v1) action and fails; the rediscovery must
		// bypass that warm cache to read the moved (v2) action and retry the same URL.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		val cache = Cache(temporaryFolder.newFolder("cache"), 10L * 1024 * 1024)
		val queueGets = AtomicInteger()
		server.handle { record ->
			when (record.path) {
				"/" -> Stub(303, headers = mapOf("Location" to "/queue", "Cache-Control" to "private, max-age=3600"))
				"/queue" -> cacheableCollection(saveArticleHref = if (queueGets.incrementAndGet() == 1) "/queue/save-v1" else "/queue/save-v2")
				"/queue/save-v1" -> Stub.json(410, "{}")
				"/queue/save-v2" -> Stub.json(201, Fixtures.article("url-saved"))
				else -> Stub.json(404, "{}")
			}
		}

		var saved = 0
		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = CapturedPage.Empty), container = container, cache = cache)
		val outcome = saver.run(
			url = "https://example.com/post",
			fallbackTitle = null,
			sharedPdf = null,
			onSaved = { saved += 1 },
		)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals(
			"the save is retried exactly once, against the action the fresh discovery advertised, with the same URL",
			listOf("/queue/save-v1", "/queue/save-v2"),
			server.records.filter { it.method == "POST" }.map { it.path },
		)
		assertEquals("https://example.com/post", postedUrl(server.records.last { it.method == "POST" }))
		val rediscovery = server.records.filter { it.method == "GET" }.takeLast(2)
		assertEquals(
			"the re-discovery starts from the entry point, the one URL the client knows",
			listOf("/", "/queue"),
			rediscovery.map { it.path },
		)
		val bypass = CacheControl.FORCE_NETWORK.toString()
		assertEquals(
			"and bypasses the discovery cache on every rebuilt hop, so the moved href is never re-read from the stale copy",
			listOf(bypass, bypass),
			rediscovery.map { it.header("Cache-Control") },
		)
		assertEquals("the rediscovered page admits exactly one capture job", 1, queuedJobs(container).size)
		assertEquals("the sheet is told the link is saved exactly once", 1, saved)
		assertTrue("the retried save landed, so the app owes the list a refresh", UnseenSave(container).exists)
		assertUploadedNothing()
	}

	@Test
	fun `retries the save only once`() = runTest {
		// The moved action fails too: one re-discovery and one retry, then the second
		// failure surfaces rather than looping.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, movableCollection(saveArticleHref = "/queue/save-v1"))
				"/queue/save-v1" -> Stub.json(410, "{}")
				else -> Stub.json(404, "{}")
			}
		}

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = CapturedPage.Empty), container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.Failed("Server error 410."), outcome)
		assertEquals(
			"one re-discovery and one retry: a second failure surfaces instead of looping",
			2,
			server.records.count { it.method == "POST" },
		)
		assertEquals(
			"the collection was read twice — the discovery and the one re-discovery",
			2,
			server.records("/queue").count { it.method == "GET" },
		)
		assertFalse("nothing landed, so the app owes the list no reset", UnseenSave(container).exists)
	}

	@Test
	fun `does not re-discover after a forbidden save`() = runTest {
		// A 403 is the server's answer to this exact request, not a stale address, so
		// the save is not re-discovered and retried.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" ->
					if (record.method == "POST") {
						Stub.json(403, "{}")
					} else {
						Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"))))
					}
				else -> Stub.json(404, "{}")
			}
		}

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = CapturedPage.Empty), container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.Failed("Server error 403."), outcome)
		assertEquals("a 403 is the server's answer, not a stale address: no re-discovery, no retry", 1, urlOnlyPosts().size)
		assertEquals(1, server.records("/queue").count { it.method == "GET" })
	}

	@Test
	fun `does not re-discover after a non-403 refusal`() = runTest {
		// A 402 whose only message is in a media type the client can't render still
		// classifies as a refusal — refusal identity, not the 403 exclusion, is what
		// stops the retry — so it is never re-discovered, and it falls back to the
		// client's own words with no article to enrich.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" ->
					if (record.method == "POST") {
						Stub.json(402, Fixtures.messageRefusal(mediaType = "text/markdown", body = "**inactive**"))
					} else {
						Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"))))
					}
				else -> Stub.json(404, "{}")
			}
		}

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = CapturedPage.Empty), container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(
			"the message is dropped for its media type, but the refusal still stands rather than degrading to a generic failure",
			SaveSharedOutcome.Refused(emptyList()),
			outcome,
		)
		assertEquals("a refusal is never re-discovered and retried", 1, urlOnlyPosts().size)
		assertEquals(emptyList<UploadJob>(), queuedJobs(container))
		assertFalse("no link landed, so the app owes the list no reset", UnseenSave(container).exists)
	}

	@Test
	fun `saves without admission when the re-discovered page dropped save-content`() = runTest {
		// The moved collection no longer advertises save-content. The URL save still
		// lands on its fresh action; there is just nowhere to send a capture, so no job
		// is admitted from the obsolete page.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		val queueGets = AtomicInteger()
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" ->
					if (queueGets.incrementAndGet() == 1) {
						Stub.json(200, movableCollection(saveArticleHref = "/queue/save-v1", withSaveContent = true))
					} else {
						Stub.json(200, movableCollection(saveArticleHref = "/queue/save-v2", withSaveContent = false))
					}
				"/queue/save-v1" -> Stub.json(410, "{}")
				"/queue/save-v2" -> Stub.json(201, Fixtures.article("url-saved"))
				else -> Stub.json(404, "{}")
			}
		}

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html()), container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.Saved(emptyList()), outcome)
		assertEquals(listOf("/queue/save-v1", "/queue/save-v2"), server.records.filter { it.method == "POST" }.map { it.path })
		assertEquals("the obsolete page offered no home for a capture, so nothing is queued", emptyList<UploadJob>(), queuedJobs(container))
		assertTrue("the retried save landed", UnseenSave(container).exists)
		assertUploadedNothing()
	}

	@Test
	fun `gives up when the re-discovered collection offers no save action`() = runTest {
		// The fresh discovery is the truth: with no save action advertised there is
		// nothing left to retry.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		val queueGets = AtomicInteger()
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" ->
					if (queueGets.incrementAndGet() == 1) {
						Stub.json(200, movableCollection(saveArticleHref = "/queue/save-v1"))
					} else {
						Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1")), actionsJson = ""))
					}
				"/queue/save-v1" -> Stub.json(404, "{}")
				else -> Stub.json(404, "{}")
			}
		}

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = CapturedPage.Empty), container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.NoSaveAction, outcome)
		assertEquals(
			"only the first, stale-href save was attempted",
			listOf("/queue/save-v1"),
			server.records.filter { it.method == "POST" }.map { it.path },
		)
		assertFalse(UnseenSave(container).exists)
	}

	@Test
	fun `a cancellation while an eligible save failure is in flight adds no re-discovery`() = runTest {
		// The first save is parked in flight, then the journey is cancelled and the save
		// released. Cancellation propagates rather than being treated as an eligible
		// failure, so no replacement save is discovered — even though the parked save
		// may already have reached the server.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		val gate = RecordingServer.Gate()
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" ->
					if (record.method == "POST") {
						gate.holding(Stub.json(410, "{}"))
					} else {
						Stub.json(200, movableCollection(saveArticleHref = "/queue"))
					}
				else -> Stub.json(404, "{}")
			}
		}

		var outcome: SaveSharedOutcome? = null
		val saver = makeSaver(
			store = store,
			captor = FakeHtmlCaptor(page = CapturedPage.Empty),
			container = container,
			ioDispatcher = Dispatchers.IO,
		)
		val journey = launch {
			outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)
		}
		awaitArrival(gate)
		journey.cancel()
		gate.release()
		journey.join()

		assertTrue(journey.isCancelled)
		assertNull("a cancelled journey paints nothing", outcome)
		assertEquals("no replacement save is discovered after the cancellation", 1, urlOnlyPosts().size)
		assertEquals("the cancellation adds no re-discovery of the collection", 1, server.records("/queue").count { it.method == "GET" })
	}

	@Test
	fun `guards when logged out`() = runTest {
		// A logged-out store must short-circuit before any network call or PDF
		// byte load.
		val loggedOut = TokenStore(InMemoryTokenStorage())
		val container = temporaryFolder.newFolder("files")
		val captor = FakeHtmlCaptor(page = html(html = "<html></html>", title = "x"))
		val saver = makeSaver(store = loggedOut, captor = captor, container = container)

		val outcome = saver.run(
			url = "https://example.com/post",
			fallbackTitle = null,
			sharedPdf = {
				fail("PDF bytes must not be loaded when logged out")
				null
			},
		)

		assertEquals(SaveSharedOutcome.NotLoggedIn, outcome)
		assertEquals(emptyList<String>(), captor.capturedUrls)
		assertTrue("no network must be attempted when logged out", server.records.isEmpty())
		assertEquals(emptyList<UploadJob>(), queuedJobs(container))
		assertUploadedNothing()
	}

	@Test
	fun `a rejected refresh grant signs the share target out so the next share asks to sign in`() = runTest {
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		server.handle { record ->
			when (record.path) {
				"/oauth/token" -> Stub.json(400, """{"error":"invalid_grant"}""")
				else -> Stub.json(401, "{}")
			}
		}
		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html()), container = container)

		val first = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)
		val second = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.Failed("Your session expired. Please sign in again."), first)
		assertEquals(SaveSharedOutcome.NotLoggedIn, second)
		assertEquals("the rejected refresh token is never sent again", 1, server.records("/oauth/token").size)
	}

	@Test
	fun `a throttled refresh keeps the share target signed in and says to try again`() = runTest {
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		server.handle { record ->
			when (record.path) {
				"/oauth/token" -> Stub(429, mapOf("Content-Type" to "text/plain", "Retry-After" to "60"), "slow down".toByteArray())
				else -> Stub.json(401, "{}")
			}
		}
		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html()), container = container)

		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.Failed("Could not refresh the session. Please try again."), outcome)
		assertEquals(OAuthTokens(AccessToken("access-1"), RefreshToken("refresh-1")), store.tokens)
	}

	@Test
	fun `names the store's failure when the tokens cannot be read`() = runTest {
		// An unreadable store is not a signed-out account: the shell must name the
		// failure rather than tell a signed-in user to sign in.
		val unreadable = TokenStore(
			InMemoryTokenStorage(unreadable = mapOf(TokenKey.ACCESS_TOKEN to AEADBadTagException("keystore key no longer decrypts"))),
		)
		val container = temporaryFolder.newFolder("files")
		val captor = FakeHtmlCaptor(page = html())
		val saver = makeSaver(store = unreadable, captor = captor, container = container)

		val outcome = saver.run(
			url = "https://example.com/post",
			fallbackTitle = null,
			sharedPdf = {
				fail("PDF bytes must not be loaded when the store cannot be read")
				null
			},
		)

		assertEquals(SaveSharedOutcome.StorageUnavailable("AEADBadTagException"), outcome)
		assertEquals(emptyList<String>(), captor.capturedUrls)
		assertTrue("no network must be attempted when the store cannot be read", server.records.isEmpty())
		assertEquals(emptyList<UploadJob>(), queuedJobs(container))
	}

	@Test
	fun `returns no link when only pdf bytes are shared`() = runTest {
		// A PDF shared with no web link (e.g. straight from the Files app) has no
		// URL to key the article on, so the journey reports NoLink before any
		// capture, network call, or PDF byte load.
		val store = loggedInStore()
		val captor = FakeHtmlCaptor(page = html(html = "<html></html>", title = "x"))
		val container = temporaryFolder.newFolder("files")
		val saver = makeSaver(store = store, captor = captor, container = container)

		val outcome = saver.run(
			url = null,
			fallbackTitle = "Form.pdf",
			sharedPdf = {
				fail("PDF bytes must not be loaded when there is no article URL")
				null
			},
		)

		assertEquals(SaveSharedOutcome.NoLink, outcome)
		assertEquals(emptyList<String>(), captor.capturedUrls)
		assertTrue("no network must be attempted without an article URL", server.records.isEmpty())
		assertEquals(emptyList<UploadJob>(), queuedJobs(container))
		assertUploadedNothing()
	}

	@Test
	fun `returns no save action when the server offers no url-only save`() = runTest {
		// The readlist loaded but advertised no `save-article`, so there is no link to
		// save and nothing to enrich.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		val searchOnly = """{ "name": "search", "href": "/queue", "method": "GET" }"""
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article(id = "a1")), actionsJson = searchOnly))
				else -> Stub.json(404, "{}")
			}
		}

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html()), container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.NoSaveAction, outcome)
		assertTrue(
			"no save must be attempted when the server offers no save action",
			server.records.none { it.method == "POST" },
		)
		assertEquals(emptyList<UploadJob>(), queuedJobs(container))
		assertUploadedNothing()
	}

	@Test
	fun `fails when the readlist response is undecodable`() = runTest {
		// The readlist replied 200 with the negotiated Siren media type but a body
		// that is not a Siren collection (a JSON array), so the journey surfaces
		// the API's own decode message as Failed — and attempts no save.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, "[]")
				else -> Stub.json(404, "{}")
			}
		}

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html()), container = container)
		val outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)

		assertEquals(SaveSharedOutcome.Failed("Could not read the server response."), outcome)
		assertEquals(emptyList<UploadJob>(), queuedJobs(container))
		assertUploadedNothing()
	}

	@Test
	fun `fails with a generic message when the failure describes nothing`() = runTest {
		// A failure the client cannot read a message out of still has to say
		// something the user can act on, rather than showing an empty card.
		val store = loggedInStore()
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html()), container = container)
		val outcome = saver.run(
			url = "https://example.com/post",
			fallbackTitle = null,
			sharedPdf = null,
			onNotice = { throw IllegalStateException() },
		)

		assertEquals(SaveSharedOutcome.Failed("Save failed."), outcome)
		assertEquals("the failure struck before the save, so no link landed", 0, urlOnlyPosts().size)
		assertEquals(emptyList<UploadJob>(), queuedJobs(container))
		assertUploadedNothing()
	}

	@Test
	fun `a cancelled journey reports no outcome`() = runTest {
		// The share target going away mid-render cancels the journey; cancellation
		// propagates rather than being painted as a failed save.
		val store = loggedInStore()
		val captor = FakeHtmlCaptor(page = html(), renderTakes = 10.minutes)
		val container = temporaryFolder.newFolder("files")
		serveReadlistAndSave()

		var outcome: SaveSharedOutcome? = null
		val saver = makeSaver(store = store, captor = captor, container = container)
		val journey = launch {
			outcome = saver.run(url = "https://example.com/post", fallbackTitle = null, sharedPdf = null)
		}
		runCurrent()
		journey.cancel()
		journey.join()

		assertTrue(journey.isCancelled)
		assertNull("a cancelled journey paints nothing", outcome)
		assertEquals("the link had already landed when the render was cut short", 1, urlOnlyPosts().size)
		assertEquals(
			listOf(UploadJob.State.CapturePending(detectedMediaType = null)),
			queuedJobs(container).map { it.state },
		)
	}

	@Test
	fun `surfaces the server save notice as soon as the list loads`() = runTest {
		// The readlist collection carries the server's save notice. The journey must
		// hand it to the shell as soon as the list loads — before the save lands —
		// so the caption is on screen for the whole phase it describes.
		val store = loggedInStore()
		val notice = """{ "type": "warning", "content": { "type": "text/html", "body": "Don't close this — it's still saving." } }"""
		serveReadlistAndSave(messagesJson = notice)

		var noticed: List<ServerMessage> = emptyList()
		var savePostsWhenNoticed = -1
		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html()), container = temporaryFolder.newFolder("files"))
		val outcome = saver.run(
			url = "https://example.com/post",
			fallbackTitle = null,
			sharedPdf = null,
			onNotice = { messages ->
				noticed = messages
				savePostsWhenNoticed = urlOnlyPosts().size
			},
		)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals(
			"the server's save notice reaches the shell verbatim",
			listOf("Don't close this — it's still saving."),
			noticed.map { it.plainText },
		)
		assertEquals("the notice is up before the save it describes", 0, savePostsWhenNoticed)
		assertUploadedNothing()
	}

	@Test
	fun `fires the notice callback empty when the server offers none`() = runTest {
		// A server that emits no collection notice still drives the callback once — with
		// no messages — so the shell can leave the caption hidden rather than assume it.
		val store = loggedInStore()
		serveReadlistAndSave()

		var callbackCount = 0
		var lastMessages: List<ServerMessage> = listOf(ServerMessage("warning", ServerMessage.Content("text/html", "stale")))
		val saver = makeSaver(store = store, captor = FakeHtmlCaptor(page = html()), container = temporaryFolder.newFolder("files"))
		val outcome = saver.run(
			url = "https://example.com/post",
			fallbackTitle = null,
			sharedPdf = null,
			onNotice = { messages ->
				callbackCount += 1
				lastMessages = messages
			},
		)

		assertEquals(SaveSharedOutcome.SavedAwaitingUpload(emptyList()), outcome)
		assertEquals("the callback fires exactly once per save", 1, callbackCount)
		assertTrue("with no server notice, the callback carries no messages", lastMessages.isEmpty())
		assertUploadedNothing()
	}

	@Test
	fun `the first racer takes the claim`() {
		assertTrue(FirstClaim().take())
	}

	@Test
	fun `every racer after the first is refused`() {
		val claim = FirstClaim()

		assertTrue(claim.take())
		assertFalse("a second resume of the same continuation would trap", claim.take())
		assertFalse(claim.take())
	}

	private object Fixtures {
		fun article(id: String, url: String = "https://example.com/post", messagesJson: String? = null): String {
			// Emitted only when set, so a fixture without it models a server that
			// sends no confirmation messages.
			val messages = if (messagesJson != null) ", \"messages\": [$messagesJson]" else ""
			return """
				{
					"class": ["article"],
					"rel": ["item"],
					"properties": {
						"id": "$id",
						"url": "$url",
						"title": "A Title",
						"status": "unread",
						"savedAt": "2026-05-30T10:00:00.000Z"$messages
					},
					"links": [{ "rel": ["read"], "href": "/queue/$id/view" }]
				}
			"""
		}

		/** The collection-level actions a healthy `/queue` advertises (URL-only save,
		 * content save, search). */
		const val COLLECTION_ACTIONS = """
			{ "name": "save-article", "href": "/queue", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }] },
			{ "name": "save-content", "href": "/queue/save-content", "method": "POST", "type": "multipart/form-data", "fields": [{ "name": "url", "type": "url" }, { "name": "content", "type": "file" }, { "name": "mediaType", "type": "text" }, { "name": "title", "type": "text" }] },
			{ "name": "search", "href": "/queue", "method": "GET", "fields": [{ "name": "status", "type": "text" }] }
		"""

		fun collection(
			entitiesJson: List<String>,
			actionsJson: String = COLLECTION_ACTIONS,
			messagesJson: String? = null,
		): String {
			// Injected into `properties` only when set, so a caller that doesn't opt in
			// models a server that emits no collection-level notice.
			val messages = if (messagesJson != null) ", \"messages\": [$messagesJson]" else ""
			return """
				{
					"class": ["collection", "articles"],
					"properties": { "total": 1, "page": 1, "pageSize": 20$messages },
					"entities": [${entitiesJson.joinToString(",\n")}],
					"links": [
						{ "rel": ["self"], "href": "/queue?page=1" },
						{ "rel": ["root"], "href": "/queue" }
					],
					"actions": [$actionsJson]
				}
			"""
		}

		/** The refusal the server returns on a write it won't allow (a locked
		 * account): server-authored messages for the client to render, and
		 * deliberately no code and no action. Single-quoted HTML keeps the fixture
		 * valid JSON. */
		fun accountLockedError(): String =
			"""{ "class": ["error"], "properties": { "messages": [{ "type": "warning", "content": { "type": "text/html", "body": "Your account is locked because your email was never verified. Email <a href='mailto:readplace+verification@readplace.com'>readplace+verification@readplace.com</a> to restore access." } }] } }"""

		/** A message-only refusal carrying one message in an arbitrary media type — lets
		 * a test model a refusal whose copy the client can't render. */
		fun messageRefusal(mediaType: String, body: String, type: String = "warning"): String =
			"""{ "class": ["error"], "properties": { "messages": [{ "type": "$type", "content": { "type": "$mediaType", "body": "$body" } }] } }"""
	}

	private companion object {
		const val USER_AGENT = "Readplace/1 Android/16"
		val NOW: Instant = Instant.parse("2026-05-30T10:00:00Z")
	}
}
