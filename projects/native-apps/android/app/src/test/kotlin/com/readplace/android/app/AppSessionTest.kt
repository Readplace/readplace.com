package com.readplace.android.app

import com.readplace.android.RecordingServer
import com.readplace.android.RecordingServer.Stub
import com.readplace.android.core.AccessToken
import com.readplace.android.core.AppConfig
import com.readplace.android.core.AuthFlowError
import com.readplace.android.core.AuthorizationRequest
import com.readplace.android.core.DiscoveryHttpCache
import com.readplace.android.core.OAuth
import com.readplace.android.core.OAuthError
import com.readplace.android.core.OAuthTokens
import com.readplace.android.core.Pkce
import com.readplace.android.core.PurgeableUploadQueue
import com.readplace.android.core.RefreshToken
import com.readplace.android.core.ShareArtifacts
import com.readplace.android.core.TokenKey
import com.readplace.android.core.TokenStorage
import com.readplace.android.core.TokenStore
import com.readplace.android.core.UnseenSave
import com.readplace.android.core.WebAuthFlow
import com.readplace.android.core.WebAuthPresentation
import com.readplace.android.core.initWebAuthFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.IOException
import java.net.ServerSocket
import java.net.URLDecoder

/**
 * The login and sign-up journeys through the real production types, with the
 * network faked. Sign-in presents `/oauth/authorize` in the injected web-auth
 * flow, which hands the captured `readplace://oauth-callback` redirect to the
 * exchange and flips the session to logged-in; sign-out revokes, clears the
 * session's own cookie jar, purges the share artifacts and wipes the reader's
 * WebView traces before the logged-out state is published.
 */
class AppSessionTest {
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

	private class RecordingUploadQueue : PurgeableUploadQueue {
		var purges = 0

		override fun purgeAll() {
			purges += 1
		}
	}

	private class RecordingWebDataWiper : WebDataWiper {
		val wiped = mutableListOf<String>()

		override suspend fun wipe(serverHost: String) {
			wiped += serverHost
		}
	}

	/** A flow that records the authorize request it was started with and answers
	 * a canned outcome: `null` models the user dismissing the sign-in page, a
	 * failure models a rejected callback. */
	private class CapturedFlow(var outcome: Result<Unit>? = null) {
		val requests = mutableListOf<AuthorizationRequest>()

		fun make(): (OAuth) -> WebAuthFlow = { _ ->
			WebAuthFlow { request ->
				requests += request
				outcome
			}
		}
	}

	private val store = TokenStore(RecordingTokenStorage())
	private val uploads = RecordingUploadQueue()
	private val wiper = RecordingWebDataWiper()

	private fun loggedInStore(access: String = "access-1", refresh: String = "refresh-1"): TokenStore {
		store.save(OAuthTokens(AccessToken(access), RefreshToken(refresh)))
		return store
	}

	private fun TestScope.session(
		store: TokenStore = this@AppSessionTest.store,
		baseUrl: String = server.baseUrl,
		newClientBuilder: () -> OkHttpClient.Builder = { OkHttpClient.Builder() },
		makeWebAuthFlow: (OAuth) -> WebAuthFlow = CapturedFlow().make(),
	): AppSession =
		AppSession(
			baseUrl = baseUrl,
			store = store,
			newClientBuilder = newClientBuilder,
			nativeUserAgent = NATIVE_USER_AGENT,
			ioDispatcher = StandardTestDispatcher(testScheduler),
			scope = this,
			makeWebAuthFlow = makeWebAuthFlow,
			webDataWiper = wiper,
			shareArtifacts = ShareArtifacts(
				uploads,
				UnseenSave(folder.newFolder()),
				DiscoveryHttpCache(folder.newFolder()),
			),
		)

	private fun callback(query: String): String = "${AppConfig.NATIVE_CALLBACK_URL}?$query"

	private suspend fun signInWith(session: AppSession, callbackQuery: String): Result<Unit> =
		session.completeSignIn(
			callbackUrl = callback(callbackQuery),
			verifier = "v",
			expectedState = "S",
			redirectUri = AppConfig.NATIVE_CALLBACK_URL,
		)

	private fun failureOf(outcome: Result<Unit>?): Throwable =
		outcome?.exceptionOrNull() ?: throw AssertionError("expected a failure, got $outcome")

	private fun tokenResponse(access: String, refresh: String): String =
		"""{ "access_token": "$access", "refresh_token": "$refresh", "token_type": "Bearer", "expires_in": 3600 }"""

	private fun tokensMinted() {
		server.handle { record ->
			when (record.path) {
				"/oauth/token" -> Stub.json(200, tokenResponse("fresh-access", "fresh-refresh"))
				else -> Stub.json(404, "{}")
			}
		}
	}

	/** Answers what sign-out and its checks send: the slogan list, whose every
	 * answer mints a session cookie into the session's jar, and the revoke. */
	private fun serveSignOut(cookieName: String = "hutch_sid") {
		server.handle { record ->
			when (record.path) {
				AppConfig.SLOGANS_PATH -> Stub(
					200,
					headers = mapOf(
						"Content-Type" to "application/json",
						"Set-Cookie" to "$cookieName=sess-abc; Path=/",
					),
					body = SLOGANS.toByteArray(Charsets.UTF_8),
				)
				"/oauth/revoke" -> Stub.json(200, "{}")
				else -> Stub.json(404, "{}")
			}
		}
	}

	/** Lets one server answer mint the session cookie into the session's jar. */
	private suspend fun seedSessionCookie(session: AppSession) {
		session.makeSloganSource().load()
	}

	/** The `Cookie` header the session's next request to the server carries — the
	 * observable form of what its isolated jar holds. */
	private suspend fun AppSession.cookieSentNext(): String? {
		makeSloganSource().load()
		return server.records(AppConfig.SLOGANS_PATH).last().header("Cookie")
	}

	/** A port nothing is listening on, so the exchange fails in the transport rather
	 * than at the server. */
	private fun unreachableBaseUrl(): String = ServerSocket(0).use { "http://127.0.0.1:${it.localPort}" }

	private fun formFields(body: ByteArray): Map<String, String> =
		String(body, Charsets.UTF_8).split("&")
			.filter { it.isNotEmpty() }
			.associate { pair ->
				val (name, value) = pair.split("=", limit = 2)
				URLDecoder.decode(name, "UTF-8") to URLDecoder.decode(value, "UTF-8")
			}

	private fun article(id: String): String =
		"""
		{
			"class": ["article"],
			"rel": ["item"],
			"properties": { "id": "$id", "url": "https://example.com/$id", "title": "A Title", "status": "unread", "savedAt": "2026-05-30T10:00:00.000Z" },
			"links": [{ "rel": ["read"], "href": "/queue/$id/view" }]
		}
		"""

	private fun collection(vararg articles: String): String =
		"""
		{
			"class": ["collection", "articles"],
			"properties": { "total": ${articles.size}, "page": 1, "pageSize": 20 },
			"entities": [${articles.joinToString(",\n")}],
			"links": [{ "rel": ["self"], "href": "/queue?page=1" }, { "rel": ["root"], "href": "/queue" }],
			"actions": []
		}
		"""

	// region session state

	@Test
	fun `isLoggedIn reflects the stored pair at construction`() = runTest {
		assertFalse(session().isLoggedIn.value)

		assertTrue(session(store = loggedInStore()).isLoggedIn.value)
	}

	@Test
	fun `refreshLoginState picks up a pair the share target stored`() = runTest {
		val session = session()
		assertFalse(session.isLoggedIn.value)
		store.save(OAuthTokens(AccessToken("access-1"), RefreshToken("refresh-1")))

		session.refreshLoginState()

		assertTrue(session.isLoggedIn.value)
	}

	// endregion

	// region sign-in

	@Test
	fun `completeSignIn exchanges the code and flips the session to logged in`() = runTest {
		tokensMinted()
		val session = session()
		assertFalse(session.isLoggedIn.value)

		val result = signInWith(session, "code=abc&state=S")

		assertEquals(Result.success(Unit), result)
		assertTrue("RootView keys off isLoggedIn to show the reading list", session.isLoggedIn.value)
		assertEquals(
			"the pair must be persisted for the share target",
			OAuthTokens(AccessToken("fresh-access"), RefreshToken("fresh-refresh")),
			store.tokens,
		)
		val exchange = server.records("/oauth/token").single()
		assertEquals("POST", exchange.method)
		assertEquals(
			mapOf(
				"grant_type" to "authorization_code",
				"code" to "abc",
				"code_verifier" to "v",
				"client_id" to "android-app",
				"redirect_uri" to AppConfig.NATIVE_CALLBACK_URL,
			),
			formFields(exchange.body),
		)
	}

	@Test
	fun `a callback whose state is not the expected one is rejected without exchanging`() = runTest {
		val session = session()

		val error = failureOf(signInWith(session, "code=abc&state=WRONG"))

		assertTrue(error is AuthFlowError.StateMismatch)
		assertEquals("Security check failed (state mismatch).", error.message)
		assertFalse(session.isLoggedIn.value)
		assertTrue("a rejected callback must not exchange the code", server.records.isEmpty())
	}

	@Test
	fun `a callback carrying an error param is denied without exchanging`() = runTest {
		val session = session()

		val error = failureOf(signInWith(session, "error=access_denied&state=S"))

		assertEquals("access_denied", (error as? AuthFlowError.Denied)?.reason)
		assertEquals("Authorization was denied (access_denied).", error.message)
		assertFalse(session.isLoggedIn.value)
		assertTrue("a denied authorization exchanges no code", server.records("/oauth/token").isEmpty())
	}

	@Test
	fun `a callback without a code is missing code without exchanging`() = runTest {
		val session = session()

		val error = failureOf(signInWith(session, "state=S"))

		assertTrue(error is AuthFlowError.MissingCode)
		assertEquals("No authorization code was returned.", error.message)
		assertTrue(server.records("/oauth/token").isEmpty())
	}

	@Test
	fun `a callback that is not a URI carries no code`() = runTest {
		val session = session()

		val error = failureOf(signInWith(session, "code=a b&state=S"))

		assertTrue(error is AuthFlowError.MissingCode)
		assertTrue(server.records.isEmpty())
	}

	@Test
	fun `an exchange the server rejects surfaces as a failure and stays logged out`() = runTest {
		server.handle { Stub.json(400, """{"error":"invalid_grant"}""") }
		val session = session()

		val error = failureOf(signInWith(session, "code=abc&state=S"))

		assertEquals(400, (error as? OAuthError.TokenExchangeFailed)?.status)
		assertEquals("Token exchange failed (HTTP 400).", error.message)
		assertFalse(session.isLoggedIn.value)
	}

	@Test
	fun `an exchange the network never delivers surfaces as a failure and stays logged out`() = runTest {
		val session = session(baseUrl = unreachableBaseUrl())

		val error = failureOf(signInWith(session, "code=abc&state=S"))

		assertTrue(error is IOException)
		assertFalse(session.isLoggedIn.value)
		assertNull(store.tokens)
	}

	// endregion

	// region login and sign up

	@Test
	fun `login starts a login authorization at the native redirect`() = runTest {
		val captured = CapturedFlow()
		val session = session(makeWebAuthFlow = captured.make())

		val outcome = session.startLogin()

		assertNull("a dismissal is a choice, not a failure to report", outcome)
		assertFalse(session.isLoggedIn.value)
		val request = captured.requests.single()
		val url = request.url.toHttpUrl()
		assertEquals(server.host, url.host)
		assertEquals("/oauth/authorize", url.encodedPath)
		assertEquals("android-app", url.queryParameter("client_id"))
		assertEquals(AppConfig.NATIVE_CALLBACK_URL, url.queryParameter("redirect_uri"))
		assertEquals("code", url.queryParameter("response_type"))
		assertEquals("S256", url.queryParameter("code_challenge_method"))
		assertEquals("login", url.queryParameter("screen_hint"))
		assertEquals(Pkce.challengeFor(request.codeVerifier), url.queryParameter("code_challenge"))
		assertEquals(request.state, url.queryParameter("state"))
		assertTrue(request.codeVerifier.length >= 43)
		assertEquals(AppConfig.NATIVE_CALLBACK_URL, request.redirectUri)
	}

	@Test
	fun `sign up starts a signup authorization at the native redirect`() = runTest {
		val captured = CapturedFlow()
		val session = session(makeWebAuthFlow = captured.make())

		session.startSignup()

		val request = captured.requests.single()
		val url = request.url.toHttpUrl()
		assertEquals(server.host, url.host)
		assertEquals("/oauth/authorize", url.encodedPath)
		assertEquals("android-app", url.queryParameter("client_id"))
		assertEquals(AppConfig.NATIVE_CALLBACK_URL, url.queryParameter("redirect_uri"))
		assertEquals("code", url.queryParameter("response_type"))
		assertEquals("S256", url.queryParameter("code_challenge_method"))
		assertEquals("signup", url.queryParameter("screen_hint"))
		assertEquals(Pkce.challengeFor(request.codeVerifier), url.queryParameter("code_challenge"))
		assertEquals(request.state, url.queryParameter("state"))
		assertEquals(AppConfig.NATIVE_CALLBACK_URL, request.redirectUri)
	}

	@Test
	fun `a failed attempt reports its failure and leaves the session signed out`() = runTest {
		val captured = CapturedFlow(outcome = Result.failure(AuthFlowError.StateMismatch()))
		val session = session(makeWebAuthFlow = captured.make())

		val error = failureOf(session.startLogin())

		assertTrue(error is AuthFlowError.StateMismatch)
		assertFalse(session.isLoggedIn.value)
	}

	@Test
	fun `the signup journey signs the session in through the captured callback`() = runTest {
		tokensMinted()
		var presented: HttpUrl? = null
		val session = session(
			makeWebAuthFlow = { oauth ->
				initWebAuthFlow(
					present = { url ->
						val authorize = url.toHttpUrl()
						presented = authorize
						WebAuthPresentation.Returned(callback("code=abc&state=${authorize.queryParameter("state")}"))
					},
					oauth = oauth,
				)
			},
		)
		assertFalse(session.isLoggedIn.value)

		val result = session.startSignup()

		assertEquals(Result.success(Unit), result)
		assertTrue("RootView keys off isLoggedIn to show the reading list", session.isLoggedIn.value)
		assertEquals(
			"the pair must be persisted for the share target",
			OAuthTokens(AccessToken("fresh-access"), RefreshToken("fresh-refresh")),
			store.tokens,
		)
		val authorize = presented ?: throw AssertionError("the flow presented no authorize URL")
		assertEquals("signup", authorize.queryParameter("screen_hint"))
		val form = formFields(server.records("/oauth/token").single().body)
		assertEquals("abc", form["code"])
		assertEquals(
			"the verifier lives in the attempt's own scope: the one posted is the one whose " +
				"challenge was presented, and it never touched the store",
			authorize.queryParameter("code_challenge"),
			Pkce.challengeFor(form.getValue("code_verifier")),
		)
	}

	// endregion

	// region sign-out

	@Test
	fun `logout clears the minted session cookie and wipes the reader store`() = runTest {
		serveSignOut()
		val session = session(store = loggedInStore())
		seedSessionCookie(session)
		assertEquals("precondition: the jar holds the cookie the server minted", "hutch_sid=sess-abc", session.cookieSentNext())

		session.logout()

		assertFalse(session.isLoggedIn.value)
		assertNull("the minted session cookie must not survive sign-out", session.cookieSentNext())
		assertEquals(
			"sign-out must wipe the reader's traces from the WebView store, scoped to the server host",
			listOf(server.host),
			wiper.wiped,
		)
		assertEquals("""{"token":"refresh-1"}""", String(server.records("/oauth/revoke").single().body, Charsets.UTF_8))
		assertNull(store.tokens)
	}

	@Test
	fun `forceLogout clears the minted session cookie and wipes the reader store`() = runTest {
		serveSignOut()
		val session = session(store = loggedInStore())
		seedSessionCookie(session)
		assertEquals("precondition: the jar holds the cookie the server minted", "hutch_sid=sess-abc", session.cookieSentNext())

		val readerWipe = session.forceLogout()

		assertFalse(session.isLoggedIn.value)
		assertNull("the minted session cookie must not survive a forced sign-out", session.cookieSentNext())
		assertNull("a forced sign-out is local: the invalid session has nothing left to revoke", store.tokens)
		assertTrue(server.records("/oauth/revoke").isEmpty())
		readerWipe.join()
		assertEquals(
			"sign-out must wipe the reader's traces from the WebView store, scoped to the server host",
			listOf(server.host),
			wiper.wiped,
		)
	}

	@Test
	fun `logout purges the share artifacts`() = runTest {
		serveSignOut()
		val session = session(store = loggedInStore())

		session.logout()

		assertEquals(
			"captured page bytes and cached queue responses must not outlive the session that authorised them",
			1,
			uploads.purges,
		)
	}

	@Test
	fun `forceLogout purges the share artifacts`() = runTest {
		val session = session(store = loggedInStore())

		val readerWipe = session.forceLogout()

		assertEquals(
			"a session invalidated behind the user's back leaves the same traces a deliberate sign-out does",
			1,
			uploads.purges,
		)
		readerWipe.join()
	}

	@Test
	fun `sign-out wipes the session cookie regardless of its name`() = runTest {
		// Sign-out scrubs the API session by clearing every cookie in the app's
		// isolated jar, not one matched by a hard-coded `hutch_sid`. Seed the cookie
		// under a DIFFERENT name than today's and assert it is gone too — a name-based
		// scrub would leave it behind, so this is the assertion that fails if the
		// wholesale wipe regresses to matching a fixed name.
		serveSignOut(cookieName = "hutch_session_renamed")
		val session = session(store = loggedInStore())
		seedSessionCookie(session)
		assertEquals("hutch_session_renamed=sess-abc", session.cookieSentNext())

		val readerWipe = session.forceLogout()

		assertNull(
			"sign-out clears every cookie in the app's jar, not only one matched by the known session-cookie name",
			session.cookieSentNext(),
		)
		readerWipe.join()
	}

	// endregion

	// region factories

	@Test
	fun `the session's client caches no responses`() = runTest {
		server.handle {
			Stub(
				200,
				headers = mapOf("Content-Type" to "application/json", "Cache-Control" to "max-age=60"),
				body = SLOGANS.toByteArray(Charsets.UTF_8),
			)
		}
		val session = session(
			newClientBuilder = { OkHttpClient.Builder().cache(DiscoveryHttpCache(folder.newFolder()).cache) },
		)

		assertEquals(listOf("Your #1 AI-Powered Reading List."), session.makeSloganSource().load())
		assertEquals(listOf("Your #1 AI-Powered Reading List."), session.makeSloganSource().load())

		assertEquals(
			"the app's list views must always revalidate; only the share target opts into the discovery cache",
			2,
			server.records(AppConfig.SLOGANS_PATH).size,
		)
	}

	@Test
	fun `a logged-in session's API renders the queue with the bearer preserved across the entry-point 303`() = runTest {
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, collection(article("a1"), article("a2")))
				else -> Stub.json(404, "{}")
			}
		}
		val session = session(store = loggedInStore(access = "access-1"))
		assertTrue(session.isLoggedIn.value)

		val page = session.makeApi().loadQueue()

		assertEquals(listOf("a1", "a2"), page.articles.map { it.id })
		// Proves the bearer token + Siren Accept survived the entry-point 303.
		val queueRequest = server.records("/queue").single()
		assertEquals("Bearer access-1", queueRequest.header("Authorization"))
		assertEquals(AppConfig.SIREN_MEDIA_TYPE, queueRequest.header("Accept"))
	}

	// endregion

	private companion object {
		val NATIVE_USER_AGENT: String = AppConfig.nativeUserAgent(versionCode = 1, osRelease = "16")
		const val SLOGANS = """{"slogans":["Your #1 AI-Powered Reading List."]}"""
	}
}
