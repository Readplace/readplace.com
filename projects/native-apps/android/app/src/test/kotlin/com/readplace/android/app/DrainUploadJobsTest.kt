package com.readplace.android.app

import com.readplace.android.RecordingServer
import com.readplace.android.RecordingServer.Record
import com.readplace.android.RecordingServer.Stub
import com.readplace.android.app.DrainAndHealTestSupport.Fixtures
import com.readplace.android.app.DrainAndHealTestSupport.MultipartPart
import com.readplace.android.app.DrainAndHealTestSupport.RecordingHtmlCaptor
import com.readplace.android.app.DrainAndHealTestSupport.api
import com.readplace.android.app.DrainAndHealTestSupport.loggedInStore
import com.readplace.android.app.DrainAndHealTestSupport.multipartForm
import com.readplace.android.app.DrainAndHealTestSupport.multipartParts
import com.readplace.android.core.CapturedPage
import com.readplace.android.core.HtmlCapturing
import com.readplace.android.core.TokenStore
import com.readplace.android.core.UploadJob
import com.readplace.android.core.UploadJobStore
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.net.ServerSocket
import java.time.Instant
import java.util.concurrent.atomic.AtomicReference

class DrainUploadJobsTest {
	@get:Rule
	val server = RecordingServer()

	@get:Rule
	val temporaryFolder = TemporaryFolder()

	private val epoch: Instant = Instant.ofEpochSecond(1_000_000)

	private fun TestScope.makeStore(): UploadJobStore =
		UploadJobStore(filesRoot = temporaryFolder.root, io = StandardTestDispatcher(testScheduler))

	private fun job(
		id: String = "j1",
		url: String = "https://example.com/post",
		title: String? = "A Title",
		state: UploadJob.State = UploadJob.State.CapturePending(detectedMediaType = null),
		attempts: Int = 0,
		createdAt: Instant = epoch,
		nextAttemptAt: Instant = epoch,
	): UploadJob =
		UploadJob(
			id = id,
			url = url,
			title = title,
			state = state,
			attempts = attempts,
			nextAttemptAt = nextAttemptAt,
			createdAt = createdAt,
		)

	private fun pdfHinted(url: String): UploadJob =
		job(url = url, state = UploadJob.State.CapturePending(detectedMediaType = "application/pdf"))

	private fun emptyCaptor(): RecordingHtmlCaptor = RecordingHtmlCaptor(CapturedPage.Empty)

	private fun TestScope.makeDrain(
		jobs: UploadJobStore,
		captor: HtmlCapturing,
		store: TokenStore = loggedInStore(),
		baseUrl: String = server.baseUrl,
		now: () -> Instant = { epoch },
	): DrainUploadJobs =
		DrainUploadJobs(
			api = api(server, store, StandardTestDispatcher(testScheduler), baseUrl),
			captor = captor,
			jobs = jobs,
			now = now,
		)

	private fun serveQueue(
		actionsJson: String = Fixtures.COLLECTION_ACTIONS,
		saveContent: () -> Stub = { Stub.json(201, Fixtures.article("a1")) },
	) {
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, Fixtures.collection(actionsJson = actionsJson))
				"/queue/save-content" -> saveContent()
				else -> Stub.json(404, "{}")
			}
		}
	}

	private fun servePdf(pdf: Stub?) {
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, Fixtures.collection())
				"/paper.pdf" -> pdf ?: Stub.json(404, "{}")
				"/queue/save-content" -> Stub.json(201, Fixtures.article("a1"))
				else -> Stub.json(404, "{}")
			}
		}
	}

	private fun part(upload: Record, name: String): MultipartPart? =
		multipartParts(upload.header("Content-Type"), upload.body).firstOrNull { it.name == name }

	/** A port nothing is listening on, so the call fails in the transport rather than
	 * at the server. */
	private fun unreachableBaseUrl(): String = ServerSocket(0).use { "http://127.0.0.1:${it.localPort}" }

	// region Uploading what the share sheet staged

	@Test
	fun `uploads a staged job then forgets its record and its bytes`() = runTest {
		val jobs = makeStore()
		val admitted = job()
		jobs.admit(admitted)
		val form = multipartForm(content = "<html>staged by the share sheet</html>".toByteArray(Charsets.UTF_8))
		val ready = jobs.stageReady(admitted, form)
		serveQueue()

		makeDrain(jobs, emptyCaptor()).run()

		val uploads = server.records("/queue/save-content")
		assertEquals(1, uploads.size)
		val upload = uploads.first()
		assertEquals("the upload follows the server-declared method", "POST", upload.method)
		assertEquals(
			"the staged bytes go up under the boundary they were written with",
			form.contentType,
			upload.header("Content-Type"),
		)
		assertEquals(
			"the app's upload carries the bearer, so an expired token is refreshed rather than dropped",
			"Bearer access-1",
			upload.header("Authorization"),
		)
		assertEquals("<html>staged by the share sheet</html>", part(upload, "content")?.text)
		assertEquals(emptyList<UploadJob>(), jobs.loadAll(now = epoch))
		assertFalse(
			"an uploaded body has no reason to keep occupying the files root",
			jobs.bytesFile(ready).exists(),
		)
	}

	@Test
	fun `follows the save-content action the current collection advertises`() = runTest {
		val jobs = makeStore()
		val saveContentHref = AtomicReference("/queue/save-content")
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(
					200,
					Fixtures.collection(
						actionsJson = """
							{ "name": "save-content", "title": "Save a file", "href": "${saveContentHref.get()}", "method": "POST", "type": "multipart/form-data", "fields": [] }
						""",
					),
				)
				"/queue/save-content", "/queue/moved/save-content" -> Stub.json(201, Fixtures.article("a1"))
				else -> Stub.json(404, "{}")
			}
		}
		val first = job(id = "j1", url = "https://example.com/one")
		jobs.admit(first)
		jobs.stageReady(first, multipartForm(url = "https://example.com/one"))

		makeDrain(jobs, emptyCaptor()).run()

		saveContentHref.set("/queue/moved/save-content")
		val second = job(id = "j2", url = "https://example.com/two", createdAt = epoch.plusSeconds(1))
		jobs.admit(second)
		jobs.stageReady(second, multipartForm(url = "https://example.com/two"))

		makeDrain(jobs, emptyCaptor()).run()

		assertEquals(1, server.records("/queue/save-content").size)
		assertEquals(
			"every sweep re-discovers, so a moved action is followed rather than posted to a remembered address",
			1,
			server.records("/queue/moved/save-content").size,
		)
		assertEquals(emptyList<UploadJob>(), jobs.loadAll(now = epoch.plusSeconds(1)))
	}

	// endregion

	// region Capturing what the share sheet left pending

	@Test
	fun `captures a pending job on device then uploads what it rendered`() = runTest {
		val jobs = makeStore()
		jobs.admit(job(title = "Title from the share sheet"))
		serveQueue()
		val captor = RecordingHtmlCaptor(CapturedPage.Html(html = "<html>rendered in the app</html>", title = "Rendered"))

		makeDrain(jobs, captor).run()

		assertEquals(listOf("https://example.com/post"), captor.capturedUrls)
		val upload = server.records("/queue/save-content").first()
		assertEquals("https://example.com/post", part(upload, "url")?.text)
		assertEquals("text/html", part(upload, "mediaType")?.text)
		assertEquals(
			"the rendered page names itself; the shared title is only the fallback",
			"Rendered",
			part(upload, "title")?.text,
		)
		assertEquals("<html>rendered in the app</html>", part(upload, "content")?.text)
		assertEquals(emptyList<UploadJob>(), jobs.loadAll(now = epoch))
	}

	@Test
	fun `falls back to the shared title when the render named the page nothing`() = runTest {
		val jobs = makeStore()
		jobs.admit(job(title = "Title from the share sheet"))
		serveQueue()
		val captor = RecordingHtmlCaptor(CapturedPage.Html(html = "<html>untitled</html>", title = ""))

		makeDrain(jobs, captor).run()

		val upload = server.records("/queue/save-content").first()
		assertEquals(
			"an empty document.title is no name at all, so the shared title stands in",
			"Title from the share sheet",
			part(upload, "title")?.text,
		)
	}

	@Test
	fun `fetches the pdf itself for a pdf-hinted job without the bearer`() = runTest {
		val jobs = makeStore()
		val pdfBytes = "%PDF-1.7 the paper".toByteArray(Charsets.UTF_8)
		jobs.admit(pdfHinted(url = "${server.baseUrl}/paper.pdf"))
		servePdf(Stub(200, headers = mapOf("Content-Type" to "application/pdf"), body = pdfBytes))
		val captor = RecordingHtmlCaptor(CapturedPage.Html(html = "<html>never rendered</html>", title = null))

		makeDrain(jobs, captor).run()

		assertEquals("a PDF is fetched as bytes, never rendered", emptyList<String>(), captor.capturedUrls)
		val fetch = server.records("/paper.pdf").first()
		assertNull("a third-party origin must never see the Readplace bearer", fetch.header("Authorization"))
		val upload = server.records("/queue/save-content").first()
		assertEquals("application/pdf", part(upload, "mediaType")?.text)
		assertEquals("A Title", part(upload, "title")?.text)
		assertArrayEquals(pdfBytes, part(upload, "content")?.body)
		assertEquals(emptyList<UploadJob>(), jobs.loadAll(now = epoch))
	}

	@Test
	fun `drops a pdf-hinted job whose fetch brings back something that is not a pdf`() = runTest {
		val jobs = makeStore()
		jobs.admit(pdfHinted(url = "${server.baseUrl}/paper.pdf"))
		servePdf(
			Stub(
				200,
				headers = mapOf("Content-Type" to "text/html"),
				body = "<html>sign in to read this paper</html>".toByteArray(Charsets.UTF_8),
			),
		)

		makeDrain(jobs, emptyCaptor()).run()

		assertTrue(
			"bytes that are not the PDF they claim to be are never uploaded as one",
			server.records("/queue/save-content").isEmpty(),
		)
		assertEquals(emptyList<UploadJob>(), jobs.loadAll(now = epoch))
	}

	@Test
	fun `drops a pdf-hinted job whose fetch brings back nothing`() = runTest {
		val jobs = makeStore()
		jobs.admit(pdfHinted(url = "${server.baseUrl}/paper.pdf"))
		servePdf(pdf = null)

		makeDrain(jobs, emptyCaptor()).run()

		assertEquals(1, server.records("/paper.pdf").size)
		assertTrue(server.records("/queue/save-content").isEmpty())
		assertEquals(
			"with no bytes to send the server's own crawl is the last resort, so the job is not kept",
			emptyList<UploadJob>(),
			jobs.loadAll(now = epoch),
		)
	}

	@Test
	fun `drops a pending job whose on-device capture comes back empty`() = runTest {
		val jobs = makeStore()
		jobs.admit(job())
		serveQueue()
		val captor = emptyCaptor()

		makeDrain(jobs, captor).run()

		assertEquals(listOf("https://example.com/post"), captor.capturedUrls)
		assertTrue(
			"with nothing rendered the server's own crawl is the last resort, so nothing is uploaded",
			server.records("/queue/save-content").isEmpty(),
		)
		assertEquals(emptyList<UploadJob>(), jobs.loadAll(now = epoch))
	}

	@Test
	fun `drops a pending job whose render produced an empty document`() = runTest {
		val jobs = makeStore()
		jobs.admit(job())
		serveQueue()

		makeDrain(jobs, RecordingHtmlCaptor(CapturedPage.Html(html = "", title = "Rendered"))).run()

		assertTrue("an empty document is nothing to save", server.records("/queue/save-content").isEmpty())
		assertEquals(emptyList<UploadJob>(), jobs.loadAll(now = epoch))
	}

	@Test
	fun `drops a pending job whose on-device capture found a pdf instead of a page`() = runTest {
		val jobs = makeStore()
		jobs.admit(job())
		serveQueue()

		makeDrain(jobs, RecordingHtmlCaptor(CapturedPage.PdfDetected)).run()

		assertTrue(
			"a capture that rendered no HTML has nothing to upload, so the job is not kept",
			server.records("/queue/save-content").isEmpty(),
		)
		assertEquals(emptyList<UploadJob>(), jobs.loadAll(now = epoch))
	}

	// endregion

	// region What the server's answer decides

	@Test
	fun `drops a job the server refuses with its own verdict`() = runTest {
		val jobs = makeStore()
		val admitted = job()
		jobs.admit(admitted)
		val ready = jobs.stageReady(admitted, multipartForm())
		serveQueue(saveContent = { Stub.json(403, Fixtures.accountLockedError()) })

		makeDrain(jobs, emptyCaptor()).run()

		assertEquals(
			"a refusal is the server's verdict on these exact bytes, and the link itself is already saved",
			emptyList<UploadJob>(),
			jobs.loadAll(now = epoch),
		)
		assertFalse(jobs.bytesFile(ready).exists())
	}

	@Test
	fun `drops a job the server rejects with a 4xx`() = runTest {
		val jobs = makeStore()
		val admitted = job()
		jobs.admit(admitted)
		val ready = jobs.stageReady(admitted, multipartForm())
		serveQueue(saveContent = {
			Stub.json(415, Fixtures.sirenError(code = "unsupported_media_type", message = "That content can't be saved."))
		})

		makeDrain(jobs, emptyCaptor()).run()

		assertEquals(
			"resending bytes the server already judged would only be judged the same way",
			emptyList<UploadJob>(),
			jobs.loadAll(now = epoch),
		)
		assertFalse(jobs.bytesFile(ready).exists())
	}

	@Test
	fun `schedules a backoff retry when the server fails transiently`() = runTest {
		val jobs = makeStore()
		val admitted = job()
		jobs.admit(admitted)
		val ready = jobs.stageReady(admitted, multipartForm())
		serveQueue(saveContent = { Stub.json(503, Fixtures.sirenError(code = "unavailable", message = "Try again later.")) })

		makeDrain(jobs, emptyCaptor()).run()

		assertEquals(
			"the job waits out its backoff rather than being retried on this sweep",
			emptyList<UploadJob>(),
			jobs.loadAll(now = epoch),
		)
		val waiting = jobs.loadAll(now = epoch.plusSeconds(60)).first()
		assertEquals(1, waiting.attempts)
		assertEquals(epoch.plusSeconds(60), waiting.nextAttemptAt)
		assertTrue(
			"the staged bytes survive the failure, so the retry has something to send",
			jobs.bytesFile(ready).exists(),
		)
	}

	@Test
	fun `keeps a mid-sweep capture staged when its upload fails transiently`() = runTest {
		val jobs = makeStore()
		jobs.admit(job())
		serveQueue(saveContent = { Stub.json(503, Fixtures.sirenError(code = "unavailable", message = "Try again later.")) })
		val captor = RecordingHtmlCaptor(CapturedPage.Html(html = "<html>rendered once</html>", title = "Rendered"))

		makeDrain(jobs, captor).run()

		val waiting = jobs.loadAll(now = epoch.plusSeconds(60)).first()
		assertEquals(1, waiting.attempts)
		assertTrue(
			"the render already happened; losing it to the retry would re-pay the capture",
			jobs.bytesFile(waiting).exists(),
		)

		serveQueue()
		makeDrain(jobs, captor, now = { epoch.plusSeconds(60) }).run()

		assertEquals(
			"the retry sends the bytes it already staged instead of rendering the page again",
			listOf("https://example.com/post"),
			captor.capturedUrls,
		)
		val uploads = server.records("/queue/save-content")
		assertEquals(2, uploads.size)
		assertEquals("<html>rendered once</html>", part(uploads.last(), "content")?.text)
		assertEquals(emptyList<UploadJob>(), jobs.loadAll(now = epoch.plusSeconds(60)))
	}

	@Test
	fun `drops a job that has spent its whole retry budget`() = runTest {
		val jobs = makeStore()
		val admitted = job(attempts = 7)
		jobs.admit(admitted)
		val ready = jobs.stageReady(admitted, multipartForm())
		serveQueue(saveContent = { Stub.json(503, "{}") })

		makeDrain(jobs, emptyCaptor()).run()

		assertEquals(emptyList<UploadJob>(), jobs.loadAll(now = epoch.plusSeconds(86_400)))
		assertFalse(jobs.bytesFile(ready).exists())
	}

	@Test
	fun `stops the sweep when the session cannot be refreshed`() = runTest {
		val jobs = makeStore()
		val first = job(id = "j1", url = "https://example.com/one")
		jobs.admit(first)
		val readyFirst = jobs.stageReady(first, multipartForm(url = "https://example.com/one"))
		val second = job(id = "j2", url = "https://example.com/two", createdAt = epoch.plusSeconds(1))
		jobs.admit(second)
		val readySecond = jobs.stageReady(second, multipartForm(url = "https://example.com/two"))
		serveQueue(saveContent = { Stub.json(401, "{}") })

		makeDrain(jobs, emptyCaptor()).run()

		assertEquals(
			"the one refresh inside send() already ran and failed, so a second job would only race a rotating refresh token",
			1,
			server.records("/queue/save-content").size,
		)
		assertEquals(
			"a dead session costs no job its place in the queue",
			listOf(readyFirst, readySecond),
			jobs.loadAll(now = epoch.plusSeconds(1)),
		)
	}

	@Test
	fun `reschedules a job whose advertised action cannot be followed`() = runTest {
		val jobs = makeStore()
		val admitted = job()
		jobs.admit(admitted)
		val ready = jobs.stageReady(admitted, multipartForm())
		serveQueue(
			actionsJson = """
				{ "name": "save-content", "href": "readplace://oauth-callback/android", "method": "POST", "type": "multipart/form-data", "fields": [] }
			""",
		)

		makeDrain(jobs, emptyCaptor()).run()

		assertTrue(
			"the client never constructs a request on a scheme it does not speak",
			server.records.none { it.method == "POST" },
		)
		val waiting = jobs.loadAll(now = epoch.plusSeconds(60)).single()
		assertEquals(
			"an action the client cannot follow is no verdict on the bytes, so the job waits out a backoff instead",
			1,
			waiting.attempts,
		)
		assertTrue(jobs.bytesFile(ready).exists())
	}

	@Test
	fun `reschedules a ready job whose staged body has gone missing`() = runTest {
		val jobs = makeStore()
		val admitted = job()
		jobs.admit(admitted)
		val ready = jobs.stageReady(admitted, multipartForm())
		assertTrue(jobs.bytesFile(ready).delete())
		serveQueue()

		makeDrain(jobs, emptyCaptor()).run()

		assertTrue(server.records("/queue/save-content").isEmpty())
		assertEquals(
			"a body that cannot be read is retried, and the retry budget is what eventually drops it",
			1,
			jobs.loadAll(now = epoch.plusSeconds(60)).single().attempts,
		)
	}

	@Test
	fun `records no retry into a queue purged mid-sweep`() = runTest {
		val jobs = makeStore()
		val admitted = job()
		jobs.admit(admitted)
		jobs.stageReady(admitted, multipartForm())
		serveQueue(saveContent = {
			jobs.purgeAll()
			Stub.json(503, "{}")
		})

		makeDrain(jobs, emptyCaptor()).run()

		assertEquals(
			"a sign-out purge is final: the retry must not write the queue back into being",
			emptyList<UploadJob>(),
			jobs.loadAll(now = epoch.plusSeconds(60)),
		)
		assertFalse(File(temporaryFolder.root, "upload-queue").exists())
	}

	// endregion

	// region Sweeps that never reach an upload

	@Test
	fun `drops every due job when the server advertises no save-content`() = runTest {
		val jobs = makeStore()
		val staged = job(id = "j1", url = "https://example.com/one")
		jobs.admit(staged)
		val ready = jobs.stageReady(staged, multipartForm(url = "https://example.com/one"))
		jobs.admit(job(id = "j2", url = "https://example.com/two", createdAt = epoch.plusSeconds(1)))
		serveQueue(actionsJson = Fixtures.SAVE_ARTICLE_ONLY)
		val captor = RecordingHtmlCaptor(CapturedPage.Html(html = "<html>hi</html>", title = null))

		makeDrain(jobs, captor).run()

		assertEquals(
			"with no advertised home for the content nothing will ever upload them, so they are not kept forever",
			emptyList<UploadJob>(),
			jobs.loadAll(now = epoch.plusSeconds(1)),
		)
		assertFalse(jobs.bytesFile(ready).exists())
		assertEquals("there is no point rendering a page nothing can receive", emptyList<String>(), captor.capturedUrls)
		assertTrue(server.records.none { it.method == "POST" })
	}

	@Test
	fun `leaves a job alone until its next attempt time arrives`() = runTest {
		val jobs = makeStore()
		val waiting = job(nextAttemptAt = epoch.plusSeconds(60))
		jobs.admit(waiting)
		val ready = jobs.stageReady(waiting, multipartForm())
		serveQueue()

		makeDrain(jobs, emptyCaptor()).run()

		assertTrue("a sweep with nothing due costs no round trip at all", server.records.isEmpty())
		assertEquals(listOf(ready), jobs.loadAll(now = epoch.plusSeconds(60)))
	}

	@Test
	fun `stops the sweep the moment the session is gone`() = runTest {
		val jobs = makeStore()
		val store = loggedInStore()
		val first = job(id = "j1", url = "https://example.com/one")
		jobs.admit(first)
		jobs.stageReady(first, multipartForm(url = "https://example.com/one"))
		val second = job(id = "j2", url = "https://example.com/two", createdAt = epoch.plusSeconds(1))
		jobs.admit(second)
		val readySecond = jobs.stageReady(second, multipartForm(url = "https://example.com/two"))
		serveQueue(saveContent = {
			store.clear()
			Stub.json(201, Fixtures.article("a1"))
		})

		makeDrain(jobs, emptyCaptor(), store = store).run()

		assertEquals(
			"a session that vanished mid-sweep sends no further bytes under whatever token comes next",
			1,
			server.records("/queue/save-content").size,
		)
		assertEquals(
			"the stranded job keeps its place and its retry budget",
			listOf(readySecond),
			jobs.loadAll(now = epoch.plusSeconds(1)),
		)
	}

	@Test
	fun `stops the sweep the moment it is cancelled`() = runTest {
		val jobs = makeStore()
		jobs.admit(job(id = "j1", url = "https://example.com/one"))
		val second = job(id = "j2", url = "https://example.com/two", createdAt = epoch.plusSeconds(1))
		jobs.admit(second)
		serveQueue()
		lateinit var sweep: Job
		val captor = RecordingHtmlCaptor(CapturedPage.Empty) { sweep.cancel() }
		val drain = makeDrain(jobs, captor)

		sweep = launch { drain.run() }
		sweep.join()

		assertEquals("a cancelled sweep renders nothing further", listOf("https://example.com/one"), captor.capturedUrls)
		assertEquals(
			"the job the cancelled sweep never reached keeps its place",
			listOf(second),
			jobs.loadAll(now = epoch.plusSeconds(1)),
		)
		assertTrue(server.records.none { it.method == "POST" })
	}

	@Test
	fun `sweeps an orphaned body even when nothing is due`() = runTest {
		val jobs = makeStore()
		val orphan = jobs.bytesFile(job(id = "orphan"))
		checkNotNull(orphan.parentFile).mkdirs()
		orphan.writeText("stranded")
		serveQueue()

		makeDrain(jobs, emptyCaptor()).run()

		assertFalse(
			"a body whose record is gone can never upload, so the sweep reclaims its space",
			orphan.exists(),
		)
		assertTrue("sweeping local garbage costs no round trip", server.records.isEmpty())
	}

	@Test
	fun `leaves every job alone when discovery fails`() = runTest {
		val jobs = makeStore()
		val admitted = job()
		jobs.admit(admitted)
		val ready = jobs.stageReady(admitted, multipartForm())
		server.handle { Stub.json(503, "{}") }

		makeDrain(jobs, emptyCaptor()).run()

		assertEquals(
			"a server the sweep could not even reach spends none of the job's retry budget",
			listOf(ready),
			jobs.loadAll(now = epoch),
		)
		assertTrue(server.records("/queue/save-content").isEmpty())
	}

	@Test
	fun `leaves every job alone when the server cannot be reached`() = runTest {
		val jobs = makeStore()
		val admitted = job()
		jobs.admit(admitted)
		val ready = jobs.stageReady(admitted, multipartForm())
		serveQueue()

		makeDrain(jobs, emptyCaptor(), baseUrl = unreachableBaseUrl()).run()

		assertEquals("an offline sweep spends none of the job's retry budget", listOf(ready), jobs.loadAll(now = epoch))
		assertTrue(server.records.isEmpty())
	}

	// endregion
}
