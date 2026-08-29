package com.readplace.android.app

import com.readplace.android.RecordingServer
import com.readplace.android.RecordingServer.Record
import com.readplace.android.RecordingServer.Stub
import com.readplace.android.app.DrainAndHealTestSupport.Fixtures
import com.readplace.android.app.DrainAndHealTestSupport.MultipartPart
import com.readplace.android.app.DrainAndHealTestSupport.RecordingHtmlCaptor
import com.readplace.android.app.DrainAndHealTestSupport.api
import com.readplace.android.app.DrainAndHealTestSupport.loggedInStore
import com.readplace.android.app.DrainAndHealTestSupport.multipartParts
import com.readplace.android.core.ApiError
import com.readplace.android.core.AppConfig
import com.readplace.android.core.CapturedPage
import com.readplace.android.core.HtmlCapturing
import com.readplace.android.core.TokenStore
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class HealBlockedArticleTest {
	@get:Rule
	val server = RecordingServer()

	private val blockedUrl = "https://example.com/post"

	private fun TestScope.makeHealer(store: TokenStore, captor: HtmlCapturing): HealBlockedArticle =
		HealBlockedArticle(api = api(server, store, StandardTestDispatcher(testScheduler)), captor = captor)

	private fun htmlCaptor(html: String = "<html>hi</html>", title: String? = null): RecordingHtmlCaptor =
		RecordingHtmlCaptor(CapturedPage.Html(html = html, title = title))

	private fun serveReadlistAndSaveContent(
		actionsJson: String = Fixtures.COLLECTION_ACTIONS,
		saveContentStub: () -> Stub = { Stub.json(201, Fixtures.article("healed")) },
	) {
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(
					200,
					Fixtures.collection(entitiesJson = listOf(Fixtures.article("a1")), actionsJson = actionsJson),
				)
				"/queue/save-content" -> saveContentStub()
				else -> Stub.json(404, "{}")
			}
		}
	}

	private fun parts(upload: Record): List<MultipartPart> =
		multipartParts(upload.header("Content-Type"), upload.body)

	private inline fun <reified E : Throwable> failsWith(block: () -> Unit): E {
		try {
			block()
		} catch (error: Throwable) {
			return error as? E ?: throw error
		}
		throw AssertionError("expected ${E::class.simpleName}, but nothing was thrown")
	}

	@Test
	fun `uploads the on-device capture through the advertised save-content action`() = runTest {
		val captor = htmlCaptor(
			html = "<html><body>the page the crawler was blocked from</body></html>",
			title = "Captured",
		)
		serveReadlistAndSaveContent()

		val outcome = makeHealer(store = loggedInStore(access = "access-1"), captor = captor).run(url = blockedUrl)

		assertEquals(HealBlockedOutcome.HEALED, outcome)
		assertNull("a landed heal leaves nothing to tell the user about", outcome.failureText)
		assertEquals(
			"the heal renders the blocked origin itself, on the user's own connection",
			listOf(blockedUrl),
			captor.capturedUrls,
		)

		val uploads = server.records("/queue/save-content")
		assertEquals("one explicit user action uploads exactly once", 1, uploads.size)
		val upload = uploads.first()
		assertEquals("the upload follows the server-declared method", "POST", upload.method)
		assertEquals(
			"the foreground upload carries the bearer send() attaches, so an expired token is refreshed rather than dropped",
			"Bearer access-1",
			upload.header("Authorization"),
		)
		assertEquals(
			"the server answers save-content with 406 for a client that does not accept Siren",
			AppConfig.SIREN_MEDIA_TYPE,
			upload.header("Accept"),
		)
		assertEquals("android", upload.header("X-Readplace-Client"))

		val parts = parts(upload)
		assertEquals("https://example.com/post", parts.first { it.name == "url" }.text)
		assertEquals("text/html", parts.first { it.name == "mediaType" }.text)
		assertEquals("Captured", parts.first { it.name == "title" }.text)
		val content = parts.first { it.name == "content" }
		assertEquals("the content part needs a filename so the server treats it as a file", "content", content.filename)
		assertEquals("<html><body>the page the crawler was blocked from</body></html>", content.text)
	}

	@Test
	fun `sends no title part when the render named the page nothing`() = runTest {
		serveReadlistAndSaveContent()

		val outcome = makeHealer(store = loggedInStore(), captor = htmlCaptor(title = null)).run(url = blockedUrl)

		assertEquals(HealBlockedOutcome.HEALED, outcome)
		val upload = server.records("/queue/save-content").first()
		assertEquals(
			"an untitled render sends no title part rather than an empty one",
			listOf("url", "mediaType", "content"),
			parts(upload).mapNotNull { it.name },
		)
	}

	@Test
	fun `uploads nothing when the capture produced no html`() = runTest {
		val captor = RecordingHtmlCaptor(CapturedPage.PdfDetected)

		val outcome = makeHealer(store = loggedInStore(), captor = captor).run(url = blockedUrl)

		assertEquals(HealBlockedOutcome.CAPTURE_WAS_EMPTY, outcome)
		assertEquals(
			"This device couldn't capture that page either — the site returned nothing to save.",
			outcome.failureText,
		)
		assertTrue("a capture with nothing in it must not reach the network at all", server.records.isEmpty())
	}

	@Test
	fun `uploads nothing when the render produced an empty document`() = runTest {
		val outcome = makeHealer(store = loggedInStore(), captor = htmlCaptor(html = "", title = "Blank")).run(url = blockedUrl)

		assertEquals(HealBlockedOutcome.CAPTURE_WAS_EMPTY, outcome)
		assertTrue("an empty document is nothing to save, so no round trip is spent on it", server.records.isEmpty())
	}

	@Test
	fun `uploads nothing when the server advertises no content action`() = runTest {
		serveReadlistAndSaveContent(actionsJson = Fixtures.SAVE_ARTICLE_ONLY)

		val outcome = makeHealer(store = loggedInStore(), captor = htmlCaptor()).run(url = blockedUrl)

		assertEquals(HealBlockedOutcome.NO_SAVE_CONTENT_ACTION, outcome)
		assertEquals(
			"a heal the server offers no home for is reported, not swallowed",
			"The server offered no way to save the captured page.",
			outcome.failureText,
		)
		assertTrue(
			"the client never constructs an href the server did not advertise",
			server.records.none { it.method == "POST" },
		)
	}

	@Test
	fun `surfaces the server's refusal to the caller`() = runTest {
		serveReadlistAndSaveContent(saveContentStub = { Stub.json(403, Fixtures.accountLockedError()) })

		val error = failsWith<ApiError.Refused> {
			makeHealer(store = loggedInStore(), captor = htmlCaptor()).run(url = blockedUrl)
		}

		assertTrue(
			"the refusal carries the server's message so the caller renders it verbatim",
			error.messages.first().content.body.contains("readplace+verification@readplace.com"),
		)
	}
}
