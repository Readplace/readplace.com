package com.readplace.android.core

import com.readplace.android.RecordingServer
import com.readplace.android.RecordingServer.Stub
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.IOException
import java.net.ServerSocket
import java.net.URLDecoder
import java.util.concurrent.atomic.AtomicInteger

class ReadplaceApiTest {
	@get:Rule
	val server = RecordingServer()

	@get:Rule
	val folder = TemporaryFolder()

	private class RecordingTokenStorage : TokenStorage {
		val stored = mutableMapOf<TokenKey, String>()

		override fun readValue(key: TokenKey): Result<String?> = Result.success(stored[key])

		override fun setValue(key: TokenKey, value: String) {
			stored[key] = value
		}

		override fun removeValue(key: TokenKey) {
			stored.remove(key)
		}
	}

	private fun loggedInStore(access: String = "access-1", refresh: String = "refresh-1"): TokenStore {
		val store = TokenStore(RecordingTokenStorage())
		store.save(OAuthTokens(AccessToken(access), RefreshToken(refresh)))
		return store
	}

	/** Builds the client the way the composition root does: one OkHttp client with
	 * its own jar. A ceiling is passed only when a test lowers it, so the default
	 * ceiling is what every other test fetches under. */
	private fun TestScope.api(
		store: TokenStore = loggedInStore(),
		jar: CookieJar = EphemeralCookieJar(),
		baseUrl: String = server.baseUrl,
		oauthBaseUrl: String = server.baseUrl,
		maxExternalContentBytes: Long? = null,
	): ReadplaceApi {
		val client = OkHttpClient.Builder().cookieJar(jar).followRedirects(false).build()
		val oauth = OAuth(baseUrl = oauthBaseUrl, store = store, http = OkHttpClient())
		val dispatcher = StandardTestDispatcher(testScheduler)
		if (maxExternalContentBytes == null) {
			return ReadplaceApi(baseUrl, client, store, oauth, USER_AGENT, dispatcher)
		}
		return ReadplaceApi(baseUrl, client, store, oauth, USER_AGENT, dispatcher, maxExternalContentBytes)
	}

	private fun saveArticleAction(): SirenAction =
		SirenAction(name = "save-article", href = "/queue", method = "POST", title = null, type = "application/json", fields = null)

	private fun saveContentAction(): SirenAction =
		SirenAction(
			name = "save-content",
			href = "/queue/save-content",
			method = "POST",
			title = null,
			type = "multipart/form-data",
			fields = null,
		)

	private fun updateStatusAction(id: String = "a1", statusValue: String? = "read"): SirenAction =
		SirenAction(
			name = "update-status",
			href = "/queue/$id/status",
			method = "POST",
			title = null,
			type = "application/x-www-form-urlencoded",
			fields = listOf(SirenField(name = "status", type = "text", value = statusValue)),
		)

	/** A session cookie scoped to the server host, for seeding a cookie jar. The
	 * name is arbitrary — the client never selects the session cookie by name — so
	 * this uses a representative literal. */
	private fun sessionCookie(value: String, name: String = "hutch_sid"): Cookie =
		Cookie.Builder().name(name).value(value).domain(server.host).path("/").build()

	private fun seeded(vararg cookies: Cookie): CookieJar =
		EphemeralCookieJar().apply { saveFromResponse(server.baseUrl.toHttpUrl(), cookies.toList()) }

	/** A port nothing is listening on, so the call fails in the transport rather than
	 * at the server. */
	private fun unreachableBaseUrl(): String = ServerSocket(0).use { "http://127.0.0.1:${it.localPort}" }

	private fun formFields(body: ByteArray): Map<String, String> =
		String(body, Charsets.UTF_8).split("&")
			.filter { it.isNotEmpty() }
			.associate { pair ->
				val (name, value) = pair.split("=", limit = 2)
				URLDecoder.decode(name, "UTF-8") to URLDecoder.decode(value, "UTF-8")
			}

	private fun jsonObject(body: ByteArray): JsonObject =
		Json.parseToJsonElement(String(body, Charsets.UTF_8)).jsonObject

	private fun string(json: JsonObject, key: String): String? = json[key]?.jsonPrimitive?.content

	private inline fun <reified E : Throwable> failsWith(block: () -> Unit): E {
		try {
			block()
		} catch (error: Throwable) {
			return error as? E ?: throw error
		}
		throw AssertionError("expected ${E::class.simpleName}, but nothing was thrown")
	}

	// region Listing

	@Test
	fun `loadQueue follows the entry-point redirect and re-attaches the client's headers on the hop`() = runTest {
		val store = loggedInStore(access = "access-1")
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"), Fixtures.article("a2")), total = 2))
				else -> Stub.json(404, "{}")
			}
		}

		val page = api(store).loadQueue()

		assertEquals(listOf("a1", "a2"), page.articles.map { it.id })
		val hop = server.records("/queue").first()
		assertEquals("GET", hop.method)
		assertEquals("Bearer access-1", hop.header("Authorization"))
		assertEquals("application/vnd.siren+json", hop.header("Accept"))
		assertEquals(
			"the Android client header must survive the GET / → /queue redirect so the server records onboarding",
			"android",
			hop.header("X-Readplace-Client"),
		)
		assertEquals(
			"this build's saves survive the share sheet, so the server must drop the 'don't close this' notice",
			AppConfig.SAVE_CONTINUITY_BACKGROUND,
			hop.header(AppConfig.SAVE_CONTINUITY_HEADER),
		)
		assertEquals(
			"OkHttp would substitute its own User-Agent on a hop that lost ours",
			USER_AGENT,
			hop.header("User-Agent"),
		)
	}

	@Test
	fun `loadQueue follows a href the server handed back`() = runTest {
		server.handle { record ->
			if (record.path == "/queue") Stub.json(200, Fixtures.collection(listOf(Fixtures.article("p2")), page = 2)) else Stub.json(404, "{}")
		}

		val page = api().loadQueue(path = "/queue?page=2")

		assertEquals(listOf("p2"), page.articles.map { it.id })
		assertEquals("2", server.records.single().request.url.queryParameter("page"))
		assertEquals("the entry point is not touched when a href is given", 0, server.records("/").size)
	}

	@Test
	fun `loadQueue refreshes once and retries on a 401`() = runTest {
		val store = loggedInStore(access = "stale", refresh = "r1")
		val entryAttempts = AtomicInteger()
		server.handle { record ->
			when (record.path) {
				"/" ->
					if (entryAttempts.incrementAndGet() == 1) {
						Stub.json(401, Fixtures.sirenError(code = "invalid-token", message = "expired"))
					} else {
						Stub.json(200, Fixtures.collection(listOf(Fixtures.article("fresh"))))
					}
				"/oauth/token" -> Stub.json(200, Fixtures.tokenResponse(access = "fresh-access", refresh = "r2"))
				else -> Stub.json(404, "{}")
			}
		}

		val page = api(store).loadQueue()

		assertEquals(listOf("fresh"), page.articles.map { it.id })
		assertEquals("should retry exactly once after a refresh", 2, entryAttempts.get())
		assertEquals("refresh should happen exactly once", 1, server.records("/oauth/token").size)
		assertEquals(AccessToken("fresh-access"), store.tokens?.accessToken)
		assertEquals("Bearer fresh-access", server.records("/").last().header("Authorization"))
	}

	@Test
	fun `loadQueue is unauthorized when the refresh fails, without retrying`() = runTest {
		val store = loggedInStore(access = "stale")
		val entryAttempts = AtomicInteger()
		server.handle { record ->
			when (record.path) {
				"/" -> {
					entryAttempts.incrementAndGet()
					Stub.json(401, "{}")
				}
				"/oauth/token" -> Stub.json(400, "{}")
				else -> Stub.json(404, "{}")
			}
		}

		val error = failsWith<ApiError.Unauthorized> { api(store).loadQueue() }

		assertEquals("Your session expired. Please sign in again.", error.message)
		assertEquals("must not retry the entry point when refresh fails", 1, entryAttempts.get())
		assertEquals(1, server.records("/oauth/token").size)
	}

	@Test
	fun `loadQueue is unauthorized when the refresh fails on transport`() = runTest {
		val store = loggedInStore(access = "stale")
		server.handle { Stub.json(401, "{}") }

		failsWith<ApiError.Unauthorized> { api(store, oauthBaseUrl = unreachableBaseUrl()).loadQueue() }

		assertEquals("must not retry the entry point when refresh fails", 1, server.records("/").size)
	}

	@Test
	fun `loadQueue is unauthorized when a refreshed bearer is still refused`() = runTest {
		val store = loggedInStore(access = "stale", refresh = "r1")
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.json(401, "{}")
				"/oauth/token" -> Stub.json(200, Fixtures.tokenResponse(access = "fresh-access", refresh = "r2"))
				else -> Stub.json(404, "{}")
			}
		}

		failsWith<ApiError.Unauthorized> { api(store).loadQueue() }

		assertEquals("one retry with the refreshed bearer, never a second refresh", 2, server.records("/").size)
		assertEquals(1, server.records("/oauth/token").size)
	}

	@Test
	fun `loadQueue rejects a non-Siren body`() = runTest {
		// The client negotiated Siren with Accept; a 200 carrying a different media
		// type (e.g. a proxy HTML login page) is surfaced as unsupportedMediaType
		// rather than blind-decoded into a generic decode failure.
		server.handle { record ->
			if (record.path == "/") {
				Stub.redirect(to = "/queue")
			} else {
				Stub(200, headers = mapOf("Content-Type" to "text/html"), body = "<html><body>Sign in</body></html>".toByteArray())
			}
		}

		val error = failsWith<ApiError.UnsupportedMediaType> { api().loadQueue() }

		assertEquals("text/html", error.mediaType)
		assertEquals("The server replied in a format this app doesn't understand.", error.message)
	}

	@Test
	fun `loadQueue rejects a body with no media type at all`() = runTest {
		server.handle { Stub(200, headers = emptyMap(), body = "{}".toByteArray()) }

		val error = failsWith<ApiError.UnsupportedMediaType> { api().loadQueue() }

		assertNull(error.mediaType)
	}

	@Test
	fun `loadQueue accepts Siren with a charset parameter`() = runTest {
		// The negotiated type may arrive with a charset parameter; the essence still
		// matches, so the body parses.
		server.handle { record ->
			if (record.path == "/") {
				Stub.redirect(to = "/queue")
			} else {
				Stub(
					200,
					headers = mapOf("Content-Type" to "application/vnd.siren+json; charset=utf-8"),
					body = Fixtures.collection(listOf(Fixtures.article("a1"))).toByteArray(),
				)
			}
		}

		val page = api().loadQueue()

		assertEquals(listOf("a1"), page.articles.map { it.id })
	}

	@Test
	fun `loadQueue surfaces a decode failure for a malformed Siren body`() = runTest {
		// A 200 carrying the negotiated Siren type but a body that fails a root decode
		// (an array where the collection object is expected) is surfaced as the opaque
		// Decoding — which key or type mismatched is never handed to the caller.
		server.handle { record -> if (record.path == "/") Stub.redirect(to = "/queue") else Stub.json(200, "[1,2,3]") }

		val error = failsWith<ApiError.Decoding> { api().loadQueue() }

		assertEquals("Could not read the server response.", error.message)
	}

	@Test
	fun `loadQueue surfaces a decode failure for a body that is not JSON`() = runTest {
		server.handle { Stub.json(200, "not json") }

		failsWith<ApiError.Decoding> { api().loadQueue() }
	}

	@Test
	fun `loadQueue without a token fails before any request`() = runTest {
		val store = TokenStore(RecordingTokenStorage())
		server.handle { Stub.json(200, "{}") }

		val error = failsWith<ApiError.NoToken> { api(store).loadQueue() }

		assertEquals("Not signed in. Open Readplace and sign in first.", error.message)
		assertEquals(0, server.records.size)
	}

	@Test
	fun `loadQueue with an unusable base URL is a decode failure`() = runTest {
		server.handle { Stub.json(200, "{}") }

		failsWith<ApiError.Decoding> { api(baseUrl = "not a url").loadQueue() }

		assertEquals(0, server.records.size)
	}

	@Test
	fun `loadQueue reads the page's next link, warning, notices and named actions`() = runTest {
		server.handle {
			Stub.json(
				200,
				Fixtures.collection(
					listOf(Fixtures.article("a1")),
					extraLinks = """, { "rel": ["next"], "href": "/queue?page=2" }""",
					messagesJson = """
						{ "type": "warning", "content": { "type": "text/markdown", "body": "**skip**" } },
						{ "type": "warning", "content": { "type": "text/html", "body": "Keep this open." } }
					""",
					warningJson = """{ "code": "invalid-url", "message": "Couldn't save that." }""",
				),
			)
		}

		val page = api().loadQueue()

		assertEquals("/queue?page=2", page.nextHref)
		assertEquals(SirenWarning(code = "invalid-url", message = "Couldn't save that."), page.warning)
		assertEquals(
			"a notice in a media type the client can't render is dropped, not shown as raw text",
			listOf(ServerMessage("warning", ServerMessage.Content("text/html", "Keep this open."))),
			page.noticeMessages,
		)
		assertEquals(
			"actions first, then links, each in wire order",
			listOf("save-article", "save-content", "search", "self", "root", "next"),
			page.affordances.map { it.token },
		)
		assertEquals("/queue/save-content", page.action(named = "save-content")?.href)
		assertNull("a name the server never advertised finds nothing", page.action(named = "delete"))
	}

	@Test
	fun `a non-Siren error body is a generic server error`() = runTest {
		server.handle { Stub(502, headers = mapOf("Content-Type" to "text/html"), body = "<html>bad gateway</html>".toByteArray()) }

		val error = failsWith<ApiError.Server> { api().loadQueue() }

		assertEquals(502, error.status)
		assertNull(error.code)
		assertNull(error.serverMessage)
		assertEquals("Server error 502.", error.message)
	}

	// endregion

	// region Fetching content to upload

	@Test
	fun `fetchExternalContent sends no Authorization and no client header`() = runTest {
		val pdfBytes = "%PDF-1.7 body".toByteArray()
		server.handle { Stub(200, headers = mapOf("Content-Type" to "application/pdf"), body = pdfBytes) }

		val fetched = api(loggedInStore(access = "secret-access")).fetchExternalContent("${server.baseUrl}/pdf/1706.03762")

		assertArrayEquals(pdfBytes, fetched)
		val record = server.records.single()
		assertEquals("GET", record.method)
		assertNull("the external fetch must never carry the Readplace bearer token", record.header("Authorization"))
		assertNull(
			"the external fetch must not advertise the Readplace client to a third-party origin",
			record.header("X-Readplace-Client"),
		)
		assertEquals("the app still identifies itself, as the iOS system agent does", USER_AGENT, record.header("User-Agent"))
	}

	@Test
	fun `fetchExternalContent aborts when the streamed bytes exceed the ceiling`() = runTest {
		// No Content-Length, so the size is unknown up front: the running total must
		// trip the ceiling mid-stream and degrade to null rather than buffering the whole
		// oversize body into the share target's memory budget.
		server.handle {
			Stub(200, headers = mapOf("Content-Type" to "application/pdf"), body = ByteArray(64) { 0x41 }, chunked = true)
		}

		val fetched = api(maxExternalContentBytes = 16).fetchExternalContent("${server.baseUrl}/big.pdf")

		assertNull("a body that crosses the ceiling mid-stream must abort to null", fetched)
	}

	@Test
	fun `fetchExternalContent refuses a response announcing an oversize length`() = runTest {
		// A response whose declared Content-Length already exceeds the ceiling is refused
		// before the body is read — the cheap early-out that keeps an honestly-sized
		// oversize resource off the wire entirely.
		server.handle {
			Stub(
				200,
				headers = mapOf("Content-Type" to "application/pdf", "Content-Length" to "1000000"),
				body = "%PDF-".toByteArray(),
			)
		}

		val fetched = api(maxExternalContentBytes = 16).fetchExternalContent("${server.baseUrl}/big.pdf")

		assertNull("a response announcing an oversize Content-Length must be refused up front", fetched)
	}

	@Test
	fun `fetchExternalContent reads the body when the announced length is within the ceiling`() = runTest {
		// An honestly-sized, in-bounds Content-Length passes the announced-length guard
		// and pre-sizes the buffer, then the body is read in full.
		val body = "%PDF-1.7 within ceiling".toByteArray()
		server.handle { Stub(200, headers = mapOf("Content-Type" to "application/pdf"), body = body) }

		val fetched = api().fetchExternalContent("${server.baseUrl}/small.pdf")

		assertArrayEquals(body, fetched)
	}

	@Test
	fun `fetchExternalContent is null on a non-2xx`() = runTest {
		server.handle { Stub.json(404, "{}") }

		assertNull(api().fetchExternalContent("${server.baseUrl}/missing.pdf"))
	}

	@Test
	fun `fetchExternalContent is null on a transport failure`() = runTest {
		server.handle { Stub.json(200, "{}") }

		assertNull(api().fetchExternalContent("${unreachableBaseUrl()}/offline.pdf"))
	}

	@Test
	fun `fetchExternalContent is null for a URL it cannot parse`() = runTest {
		server.handle { Stub.json(200, "{}") }

		assertNull(api().fetchExternalContent("not a url"))
		assertEquals(0, server.records.size)
	}

	// endregion

	// region Saving URL only

	@Test
	fun `saveArticle posts the URL as JSON and asks for the representation`() = runTest {
		server.handle { Stub.json(201, Fixtures.article("url-saved")) }

		val confirmation = api().saveArticle(saveArticleAction(), url = "https://example.com/x")

		assertEquals("url-saved", confirmation.article.id)
		assertEquals(
			"a server that predates the confirmation channel yields no copy, so the sheet keeps its own",
			emptyList<ServerMessage>(),
			confirmation.messages,
		)
		val record = server.records("/queue").single()
		assertEquals("POST", record.method)
		assertEquals("return=representation", record.header("Prefer"))
		assertEquals("application/json", record.header("Content-Type"))
		assertEquals("https://example.com/x", string(jsonObject(record.body), "url"))
	}

	@Test
	fun `saveArticle keeps only the renderable confirmation messages`() = runTest {
		server.handle {
			Stub.json(
				200,
				Fixtures.article(
					"bumped",
					messagesJson = """
						{ "type": "warning", "content": { "type": "text/markdown", "body": "skip me" } },
						{ "type": "warning", "content": { "type": "text/html", "body": "Saved to your list." } }
					""",
				),
			)
		}

		val confirmation = api().saveArticle(saveArticleAction(), url = "https://example.com/x")

		assertEquals("bumped", confirmation.article.id)
		assertEquals(
			listOf(ServerMessage("warning", ServerMessage.Content("text/html", "Saved to your list."))),
			confirmation.messages,
		)
	}

	@Test
	fun `saveArticle is a decode failure when the entity has no properties`() = runTest {
		server.handle { Stub.json(201, """{ "class": ["article"] }""") }

		failsWith<ApiError.Decoding> { api().saveArticle(saveArticleAction(), url = "https://example.com/x") }
	}

	// endregion

	// region Saving content

	@Test
	fun `saveContent uploads a provided body through the authed path`() = runTest {
		server.handle { Stub.json(201, Fixtures.article("content-saved")) }
		val body = "--b\r\nContent-Disposition: form-data; name=\"content\"\r\n\r\nhi\r\n--b--\r\n".toByteArray()

		api(loggedInStore(access = "access-1")).saveContent(
			saveContentAction(),
			contentType = "multipart/form-data; boundary=b",
			body = body,
		)

		val upload = server.records("/queue/save-content").single()
		assertEquals("POST", upload.method)
		assertEquals("multipart/form-data; boundary=b", upload.header("Content-Type"))
		assertEquals(
			"bytes staged by the share target upload on the app's one authenticated path, which refreshes a stale bearer",
			"Bearer access-1",
			upload.header("Authorization"),
		)
		assertArrayEquals("the staged bytes go up byte for byte", body, upload.body)
	}

	@Test
	fun `saveContent uploads a multipart form`() = runTest {
		server.handle { Stub.json(201, Fixtures.article("content-saved")) }
		val form = MultipartForm(
			boundary = "b",
			textParts = listOf(MultipartForm.TextPart("url", "https://example.com/post")),
			filePart = MultipartForm.FilePart(name = "content", filename = "content", bytes = "<html>hi</html>".toByteArray()),
		)

		api().saveContent(saveContentAction(), form)

		val upload = server.records("/queue/save-content").single()
		assertEquals("multipart/form-data; boundary=b", upload.header("Content-Type"))
		assertArrayEquals(form.body(), upload.body)
	}

	@Test
	fun `saveContent streams a staged file`() = runTest {
		server.handle { Stub.json(201, Fixtures.article("content-saved")) }
		val body = "--b\r\nContent-Disposition: form-data; name=\"content\"\r\n\r\nstaged\r\n--b--\r\n".toByteArray()
		val staged = folder.newFile("upload.multipart").apply { writeBytes(body) }

		api().saveContent(saveContentAction(), contentType = "multipart/form-data; boundary=b", body = staged)

		val upload = server.records("/queue/save-content").single()
		assertEquals("POST", upload.method)
		assertEquals("multipart/form-data; boundary=b", upload.header("Content-Type"))
		assertArrayEquals(body, upload.body)
	}

	@Test
	fun `saveContent surfaces a server error`() = runTest {
		server.handle { Stub.json(500, Fixtures.sirenError(code = "boom", message = "nope")) }

		val error = failsWith<ApiError.Server> {
			api().saveContent(saveContentAction(), contentType = "multipart/form-data; boundary=b", body = ByteArray(0))
		}

		assertEquals(500, error.status)
		assertEquals("boom", error.code)
		assertEquals("nope", error.serverMessage)
		assertEquals("nope", error.message)
	}

	// endregion

	// region Account lockout

	@Test
	fun `saveArticle surfaces refusal messages`() = runTest {
		server.handle { Stub.json(403, Fixtures.accountLockedError()) }

		val error = failsWith<ApiError.Refused> { api().saveArticle(saveArticleAction(), url = "https://example.com/x") }

		val first = error.messages.single()
		assertEquals("warning", first.type)
		assertEquals("text/html", first.content.type)
		assertTrue(first.content.body.contains("readplace+verification@readplace.com"))
		assertEquals(
			"Your account is locked because your email was never verified. " +
				"Email readplace+verification@readplace.com to restore access.",
			error.message,
		)
	}

	@Test
	fun `saveArticle surfaces a refusal on a payment-required status`() = runTest {
		// An inactive subscription refuses the save with a 402 carrying a server-authored
		// message. The share target must render that message (a Refused), not fall
		// through to the cryptic "Server error 402" — the client reads messages[] on any
		// non-2xx status, so the fix is purely the server attaching the message body.
		server.handle {
			Stub.json(
				402,
				Fixtures.messageRefusal(listOf(Triple("warning", "text/html", "Couldn't save — your subscription isn't active."))),
			)
		}

		val error = failsWith<ApiError.Refused> { api().saveArticle(saveArticleAction(), url = "https://example.com/x") }

		assertEquals("Couldn't save — your subscription isn't active.", error.messages.single().content.body)
	}

	@Test
	fun `a refusal with no renderable message is a generic server error`() = runTest {
		// A refusal left with no renderable message falls through to a generic
		// server error rather than showing a blank banner — the message is ignored.
		server.handle { Stub.json(403, Fixtures.messageRefusal(listOf(Triple("warning", "text/markdown", "**locked**")))) }

		val error = failsWith<ApiError.Server> { api().saveArticle(saveArticleAction(), url = "https://example.com/x") }

		assertEquals(403, error.status)
		assertNull(error.code)
		assertNull(error.serverMessage)
		assertEquals("Server error 403.", error.message)
	}

	@Test
	fun `a mixed refusal keeps only the renderable messages`() = runTest {
		server.handle {
			Stub.json(
				403,
				Fixtures.messageRefusal(
					listOf(
						Triple("warning", "text/markdown", "skip me"),
						Triple("warning", "text/html", "show me"),
					),
				),
			)
		}

		val error = failsWith<ApiError.Refused> { api().saveArticle(saveArticleAction(), url = "https://example.com/x") }

		assertEquals("unknown media types are dropped, text/html kept", listOf("text/html"), error.messages.map { it.content.type })
		assertEquals("show me", error.messages.single().content.body)
	}

	// endregion

	// region Updating status

	@Test
	fun `invoke posts the declared field value form-encoded and follows the redirect`() = runTest {
		// The client supplies no field knowledge: it posts the server-declared
		// field's own `value`, encoded per the action's `type` (urlencoded → form
		// body). A bare invoke(action) is sufficient — no hardcoded status.
		server.handle { record ->
			when (record.path) {
				"/queue/a1/status" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article("remaining"))))
				else -> Stub.json(404, "{}")
			}
		}

		val page = api().invoke(updateStatusAction(statusValue = "read"))

		val status = server.records("/queue/a1/status").single()
		assertEquals("POST", status.method)
		assertEquals("application/x-www-form-urlencoded", status.header("Content-Type"))
		assertEquals(
			"the status comes from the declared field's value, not a client constant",
			mapOf("status" to "read"),
			formFields(status.body),
		)
		assertNull("the representation rides the followed redirect, so none is requested", status.header("Prefer"))
		val hop = server.records("/queue").single()
		assertEquals("the 303 to /queue is followed with a GET", "GET", hop.method)
		assertEquals(0, hop.body.size)
		assertEquals("Bearer access-1", hop.header("Authorization"))
		assertEquals(
			"the followed collection is returned as the post-action truth for the caller to adopt",
			listOf("remaining"),
			page?.articles?.map { it.id },
		)
	}

	@Test
	fun `invoke returns no page when the response is not a collection`() = runTest {
		// An invoke may land on any representation. A Siren body without the
		// `collection` class (here: an article entity) is no re-list direction —
		// and because every SirenCollection field is optional, the class is the
		// only honest discriminator against misreading an entity as a list.
		server.handle { record ->
			if (record.path == "/queue/a1/status") Stub.json(200, Fixtures.article("a1")) else Stub.json(404, "{}")
		}

		assertNull("a non-collection response carries no post-action list to adopt", api().invoke(updateStatusAction()))
	}

	@Test
	fun `invoke returns no page when the response is not Siren`() = runTest {
		// A 2xx in a media type the client doesn't speak still confirms the invoke
		// (the protocol-level outcome), but carries no collection to adopt.
		server.handle { record ->
			if (record.path == "/queue/a1/status") {
				Stub(200, headers = mapOf("Content-Type" to "text/html"), body = "<!doctype html>".toByteArray())
			} else {
				Stub.json(404, "{}")
			}
		}

		assertNull("a non-Siren response carries no post-action list to adopt", api().invoke(updateStatusAction()))
	}

	@Test
	fun `invoke returns no page when the Siren body does not parse`() = runTest {
		server.handle { Stub.json(200, "not json") }

		assertNull(api().invoke(updateStatusAction()))
	}

	@Test
	fun `invoke takes the status from the field value, not a client constant`() = runTest {
		// A server that targets a different status drives that exact value into the
		// body — proving the client never hardcodes "read".
		server.handle { record ->
			if (record.path == "/queue") {
				Stub.json(200, Fixtures.collection(listOf(Fixtures.article("remaining"))))
			} else {
				Stub.redirect(to = "/queue")
			}
		}

		api().invoke(updateStatusAction(statusValue = "archived"))

		assertEquals(
			"whatever status the field value declares is what gets posted",
			mapOf("status" to "archived"),
			formFields(server.records("/queue/a1/status").single().body),
		)
	}

	@Test
	fun `invoke encodes a GET action's field values as the query with no body`() = runTest {
		// A GET action (e.g. `search`) carries no body — the field values are the
		// query string. The generic invoker must put the server-declared field value
		// on the URL, not in the body, and send no Content-Type. A declared field
		// with no value, that the caller didn't supply either, is simply omitted.
		server.handle { record ->
			if (record.path == "/queue") Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1")))) else Stub.json(404, "{}")
		}
		val search = SirenAction(
			name = "search", href = "/queue", method = "GET", title = null, type = null,
			fields = listOf(
				SirenField(name = "status", type = "text", value = "unread"),
				SirenField(name = "order", type = "text", value = null),
			),
		)

		val page = api().invoke(search)

		val record = server.records("/queue").single()
		assertEquals("GET", record.method)
		assertEquals("a GET action's field value rides the URL query, not the body", "unread", record.request.url.queryParameter("status"))
		assertEquals("a field with neither a supplied nor a declared value is omitted", setOf("status"), record.request.url.queryParameterNames)
		assertEquals("a GET carries no body", 0, record.body.size)
		assertNull("a GET sets no Content-Type — there is nothing to encode in a body", record.header("Content-Type"))
		assertEquals(listOf("a1"), page?.articles?.map { it.id })
	}

	@Test
	fun `invoke sends a JSON body for a JSON-typed action`() = runTest {
		// An action whose declared type is application/json must post a JSON body —
		// not a form-encoded body under a JSON Content-Type. The body encoding follows
		// the action's own `type`, so a future JSON-bodied flat action invokes correctly.
		server.handle { record -> if (record.path == "/queue/a1/status") Stub.json(200, "{}") else Stub.json(404, "{}") }
		val action = SirenAction(
			name = "update-status", href = "/queue/a1/status", method = "POST",
			title = null, type = "application/json",
			fields = listOf(SirenField(name = "status", type = "text", value = "read")),
		)

		api().invoke(action)

		val record = server.records("/queue/a1/status").single()
		assertEquals("the request is labelled with the action's declared JSON type", "application/json", record.header("Content-Type"))
		assertEquals(
			"a JSON-typed action posts a JSON body, not a form-encoded one under a JSON header",
			"""{"status":"read"}""",
			String(record.body, Charsets.UTF_8),
		)
	}

	@Test
	fun `invoke rides the query for a GET action even when it is declared JSON`() = runTest {
		server.handle { record ->
			if (record.path == "/queue") Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1")))) else Stub.json(404, "{}")
		}
		val search = SirenAction(
			name = "search", href = "/queue", method = "GET", title = null, type = "application/json",
			fields = listOf(SirenField(name = "status", type = "text", value = "unread")),
		)

		api().invoke(search)

		val record = server.records("/queue").single()
		assertEquals("GET", record.method)
		assertEquals("unread", record.request.url.queryParameter("status"))
		assertEquals(0, record.body.size)
	}

	@Test
	fun `invoke surfaces a server error on a failure status`() = runTest {
		server.handle { Stub.json(500, Fixtures.sirenError(code = "boom", message = "nope")) }

		val error = failsWith<ApiError.Server> { api().invoke(updateStatusAction(), values = mapOf("status" to "read")) }

		// The client verifies the protocol-level outcome only: any non-2xx/3xx
		// is a generic server error, with no special-casing of a status code.
		assertEquals(500, error.status)
		assertEquals("boom", error.code)
		assertEquals("nope", error.serverMessage)
		assertEquals(
			"the caller's value wins over the declared default, and is what was posted",
			mapOf("status" to "read"),
			formFields(server.records("/queue/a1/status").single().body),
		)
	}

	@Test
	fun `invoke cannot follow an action without a href`() = runTest {
		server.handle { Stub.json(200, "{}") }
		val action = SirenAction(name = "update-status", href = null, method = "POST", title = null, type = null, fields = null)

		failsWith<ApiError.Decoding> { api().invoke(action) }

		assertEquals(0, server.records.size)
	}

	@Test
	fun `invoke cannot follow a href on a scheme the client does not speak`() = runTest {
		server.handle { Stub.json(200, "{}") }
		val action = SirenAction(
			name = "open", href = "readplace://oauth-callback/android", method = "GET", title = null, type = null, fields = null,
		)

		failsWith<ApiError.Decoding> { api().invoke(action) }

		assertEquals(0, server.records.size)
	}

	@Test
	fun `a 307 replays the method and body on the hop`() = runTest {
		server.handle { record ->
			when (record.path) {
				"/queue/a1/status" -> Stub.redirect(to = "/queue/a1/status-v2", status = 307)
				"/queue/a1/status-v2" -> Stub.json(200, "{}")
				else -> Stub.json(404, "{}")
			}
		}

		val page = api().invoke(updateStatusAction())

		val hop = server.records("/queue/a1/status-v2").single()
		assertEquals("POST", hop.method)
		assertEquals(mapOf("status" to "read"), formFields(hop.body))
		assertEquals("application/x-www-form-urlencoded", hop.header("Content-Type"))
		assertEquals("Bearer access-1", hop.header("Authorization"))
		assertNull(page)
	}

	@Test
	fun `a redirect without a Location is the final response`() = runTest {
		server.handle { Stub(302) }

		assertNull(api().invoke(updateStatusAction()))
		assertEquals(1, server.records.size)
	}

	@Test
	fun `a redirect loop is cut off`() = runTest {
		server.handle { Stub.redirect(to = "/") }

		val error = failsWith<IOException> { api().loadQueue() }

		assertEquals("Too many redirects: 21", error.message)
		assertEquals(21, server.records("/").size)
	}

	// endregion

	// region Reader session

	@Test
	fun `bootstrapSession returns the session cookie the mint set`() = runTest {
		server.handle { Stub(204, headers = mapOf("Set-Cookie" to "hutch_sid=sess-abc; Path=/; HttpOnly")) }

		val cookies = api().bootstrapSession()

		assertEquals(listOf("hutch_sid"), cookies.map { it.name })
		assertEquals("sess-abc", cookies.single().value)
		val mint = server.records.single()
		assertEquals("/auth/session", mint.path)
		assertEquals("POST", mint.method)
		assertEquals("Bearer access-1", mint.header("Authorization"))
	}

	@Test
	fun `bootstrapSession refreshes once when the bearer expired`() = runTest {
		val store = loggedInStore(access = "stale", refresh = "r1")
		val sessionAttempts = AtomicInteger()
		server.handle { record ->
			when (record.path) {
				"/auth/session" ->
					if (sessionAttempts.incrementAndGet() == 1) {
						Stub.json(401, "{}")
					} else {
						Stub(204, headers = mapOf("Set-Cookie" to "hutch_sid=fresh-sess; Path=/"))
					}
				"/oauth/token" -> Stub.json(200, Fixtures.tokenResponse(access = "fresh-access", refresh = "r2"))
				else -> Stub.json(404, "{}")
			}
		}

		val cookies = api(store).bootstrapSession()

		assertEquals("fresh-sess", cookies.single().value)
		assertEquals("should retry once after refreshing the bearer", 2, sessionAttempts.get())
		assertEquals(AccessToken("fresh-access"), store.tokens?.accessToken)
	}

	@Test
	fun `bootstrapSession keeps the minted cookie in its own jar`() = runTest {
		val own = EphemeralCookieJar()
		val sibling = EphemeralCookieJar()
		server.handle { Stub(204, headers = mapOf("Set-Cookie" to "hutch_sid=isolated; Path=/; Domain=${server.host}")) }

		api(jar = own).bootstrapSession()

		val url = "${server.baseUrl}/queue".toHttpUrl()
		assertEquals(listOf("isolated"), own.loadForRequest(url).map { it.value })
		assertEquals(
			"the minted session cookie must never land in a jar this instance does not own",
			emptyList<Cookie>(),
			sibling.loadForRequest(url),
		)
	}

	@Test
	fun `bootstrapSession follows a discovered action's href and method`() = runTest {
		server.handle { Stub(204, headers = mapOf("Set-Cookie" to "sess=discovered; Path=/")) }
		val action = SirenAction(name = "create-session", href = "/custom/session", method = "POST", title = null, type = null, fields = null)

		val cookies = api().bootstrapSession(action)

		assertEquals("discovered", cookies.single().value)
		val mint = server.records.single()
		assertEquals("follows the action's href, not a hard-coded path", "/custom/session", mint.path)
		assertEquals("POST", mint.method)
	}

	@Test
	fun `bootstrapSession sends no body for a discovered GET action`() = runTest {
		server.handle { Stub(200, headers = mapOf("Set-Cookie" to "sess=fetched; Path=/")) }
		val action = SirenAction(name = "create-session", href = "/custom/session", method = "GET", title = null, type = null, fields = null)

		val cookies = api().bootstrapSession(action)

		assertEquals("fetched", cookies.single().value)
		val mint = server.records.single()
		assertEquals("GET", mint.method)
		assertEquals(0, mint.body.size)
	}

	@Test
	fun `bootstrapSession returns only the cookies this response set`() = runTest {
		// A cookie an earlier request left in the jar must not be handed back as one
		// this mint set — the jar holds every cookie for the host, not just the
		// response's.
		val jar = seeded(sessionCookie(value = "old", name = "leftover"))
		server.handle { Stub(204, headers = mapOf("Set-Cookie" to "hutch_sid=minted; Path=/")) }

		val cookies = api(jar = jar).bootstrapSession()

		assertEquals("the stale jar cookie is excluded", listOf("hutch_sid"), cookies.map { it.name })
		assertEquals("minted", cookies.single().value)
	}

	@Test
	fun `bootstrapSession reads a re-minted session cookie back from the jar diff`() = runTest {
		// A prior mint left hutch_sid in the jar and an earlier request left hutch_vid;
		// this mint rotates the session id and leaves hutch_vid untouched.
		val jar = seeded(sessionCookie(value = "old"), sessionCookie(value = "v1", name = "hutch_vid"))
		server.handle { Stub(204, headers = mapOf("Set-Cookie" to "hutch_sid=new; Path=/")) }

		val cookies = api(jar = jar).bootstrapSession()

		assertEquals("the unchanged hutch_vid is excluded as prior", listOf("hutch_sid"), cookies.map { it.name })
		assertEquals("the rotated hutch_sid is read from the jar diff, not a header", "new", cookies.single().value)
		assertEquals("the mint presented what the jar held", "hutch_sid=old; hutch_vid=v1", server.records.single().header("Cookie"))
	}

	@Test
	fun `bootstrapSession falls back to the Set-Cookie header when the mint re-set an unchanged cookie`() = runTest {
		// Re-set with the same value, the cookie never enters the jar delta; the header
		// is the only place the mint's answer survives.
		val jar = seeded(sessionCookie(value = "old"))
		server.handle { Stub(204, headers = mapOf("Set-Cookie" to "hutch_sid=old; Path=/")) }

		val cookies = api(jar = jar).bootstrapSession()

		assertEquals(listOf("hutch_sid"), cookies.map { it.name })
		assertEquals("old", cookies.single().value)
	}

	@Test
	fun `bootstrapSession treats a response that sets no new cookie as a failed mint`() = runTest {
		// A stale jar cookie must not disguise a mint that set nothing as a success.
		val jar = seeded(sessionCookie(value = "old"))
		server.handle { Stub(204) }

		failsWith<ApiError.Decoding> { api(jar = jar).bootstrapSession() }
	}

	@Test
	fun `bootstrapSession surfaces a server error`() = runTest {
		server.handle { Stub.json(500, Fixtures.sirenError(code = "boom", message = "nope")) }

		val error = failsWith<ApiError.Server> { api().bootstrapSession() }

		assertEquals(500, error.status)
		assertEquals("Server error 500 (boom).", ApiError.Server(500, code = "boom", serverMessage = null).message)
	}

	@Test
	fun `bootstrapSession with an unusable base URL is a decode failure`() = runTest {
		server.handle { Stub(204) }

		failsWith<ApiError.Decoding> { api(baseUrl = "not a url").bootstrapSession() }

		assertEquals(0, server.records.size)
	}

	// endregion

	// region Cookie jar

	@Test
	fun `the ephemeral jar replaces a cookie by name, domain and path and serves only the matching ones`() {
		val jar = EphemeralCookieJar()
		val origin = "https://example.com/".toHttpUrl()
		fun cookie(value: String, path: String) =
			Cookie.Builder().name("hutch_sid").value(value).domain("example.com").path(path).build()

		jar.saveFromResponse(origin, listOf(cookie("first", "/"), cookie("scoped", "/reader")))
		jar.saveFromResponse(origin, listOf(cookie("second", "/")))

		assertEquals(listOf("second"), jar.loadForRequest(origin).map { it.value })
		assertEquals(
			listOf("scoped", "second"),
			jar.loadForRequest("https://example.com/reader/a1".toHttpUrl()).map { it.value },
		)
		assertEquals(emptyList<Cookie>(), jar.loadForRequest("https://other.example/".toHttpUrl()))
	}

	// endregion

	private object Fixtures {
		fun article(
			id: String = "a1",
			url: String = "https://example.com/post",
			title: String? = "A Title",
			siteName: String? = "Example",
			excerpt: String? = "An excerpt.",
			imageUrl: String? = "https://example.com/img.png",
			readTime: Int? = 6,
			status: String = "unread",
			savedAt: String = "2026-05-30T10:00:00.000Z",
			readAt: String? = null,
			isRead: Boolean? = null,
			messagesJson: String? = null,
		): String {
			fun field(key: String, value: String?): String =
				if (value != null) "\"$key\": \"$value\"" else "\"$key\": null"
			fun numField(key: String, value: Int?): String =
				if (value != null) "\"$key\": $value" else "\"$key\": null"
			// Emitted only when set, so a fixture without it models an older server that
			// doesn't advertise the explicit read-state, or one that sends no messages.
			val isReadField = if (isRead != null) ", \"isRead\": $isRead" else ""
			val messagesField = if (messagesJson != null) ", \"messages\": [$messagesJson]" else ""
			return """
				{
					"class": ["article"],
					"rel": ["item"],
					"properties": {
						"id": "$id",
						"url": "$url",
						${field("title", title)},
						${field("siteName", siteName)},
						${field("excerpt", excerpt)},
						${field("imageUrl", imageUrl)},
						${numField("estimatedReadTimeMinutes", readTime)},
						"status": "$status",
						"savedAt": "$savedAt",
						${field("readAt", readAt)}$isReadField$messagesField
					},
					"links": [{ "rel": ["read"], "href": "/queue/$id/view" }],
					"actions": [
						{ "name": "delete", "href": "/queue/$id/delete", "method": "POST" },
						{ "name": "update-status", "href": "/queue/$id/status", "method": "POST", "type": "application/x-www-form-urlencoded", "fields": [{ "name": "status", "type": "text", "value": "read" }] }
					]
				}
			"""
		}

		/** The collection-level actions a healthy `/queue` advertises (URL-only save,
		 * HTML save, file save, search), each carrying the server's `title` label. */
		const val COLLECTION_ACTIONS = """
			{ "name": "save-article", "title": "Save a link", "href": "/queue", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }] },
			{ "name": "save-content", "title": "Save a file", "href": "/queue/save-content", "method": "POST", "type": "multipart/form-data", "fields": [{ "name": "url", "type": "url" }, { "name": "content", "type": "file" }, { "name": "mediaType", "type": "text" }, { "name": "title", "type": "text" }] },
			{ "name": "search", "title": "Search", "href": "/queue", "method": "GET", "fields": [{ "name": "status", "type": "text" }, { "name": "order", "type": "text" }, { "name": "page", "type": "number" }, { "name": "url", "type": "url" }] }
		"""

		fun collection(
			entitiesJson: List<String>,
			extraLinks: String = "",
			page: Int = 1,
			total: Int = 1,
			actionsJson: String = COLLECTION_ACTIONS,
			messagesJson: String? = null,
			warningJson: String? = null,
		): String {
			// Injected into `properties` only when set, so a caller that doesn't opt in
			// models a server that emits no collection-level notices or warning.
			val messages = if (messagesJson != null) ", \"messages\": [$messagesJson]" else ""
			val warning = if (warningJson != null) ", \"warning\": $warningJson" else ""
			return """
				{
					"class": ["collection", "articles"],
					"properties": { "total": $total, "page": $page, "pageSize": 20$messages$warning },
					"entities": [${entitiesJson.joinToString(",\n")}],
					"links": [
						{ "rel": ["self"], "href": "/queue?page=$page" },
						{ "rel": ["root"], "href": "/queue" }$extraLinks
					],
					"actions": [$actionsJson]
				}
			"""
		}

		fun tokenResponse(access: String, refresh: String?): String {
			val refreshLine = if (refresh != null) "\"refresh_token\": \"$refresh\"," else ""
			return """{ "access_token": "$access", $refreshLine "token_type": "Bearer", "expires_in": 3600 }"""
		}

		fun sirenError(code: String, message: String): String =
			"""{ "class": ["error"], "properties": { "code": "$code", "message": "$message" } }"""

		/** The refusal the server returns on a write it won't allow (e.g. a locked
		 * account): server-authored messages for the client to render, and
		 * deliberately no code and no action. Single-quoted HTML keeps the fixture
		 * valid JSON. */
		fun accountLockedError(
			message: String = "Your account is locked because your email was never verified. " +
				"Email <a href='mailto:readplace+verification@readplace.com'>readplace+verification@readplace.com</a> to restore access.",
		): String =
			"""{ "class": ["error"], "properties": { "messages": [{ "type": "warning", "content": { "type": "text/html", "body": "$message" } }] } }"""

		/** A message-only refusal carrying arbitrary messages — lets a test model a
		 * media type the client doesn't understand. Each triple is (type, mediaType, body). */
		fun messageRefusal(messages: List<Triple<String, String, String>>): String {
			val items = messages.joinToString(", ") { (type, mediaType, body) ->
				"""{ "type": "$type", "content": { "type": "$mediaType", "body": "$body" } }"""
			}
			return """{ "class": ["error"], "properties": { "messages": [$items] } }"""
		}
	}

	private companion object {
		const val USER_AGENT = "Readplace/1 Android/16"
	}
}
