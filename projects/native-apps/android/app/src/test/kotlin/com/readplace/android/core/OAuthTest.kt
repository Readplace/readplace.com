package com.readplace.android.core

import com.readplace.android.RecordingServer
import com.readplace.android.RecordingServer.Gate
import com.readplace.android.RecordingServer.Stub
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.junit4.MockWebServerRule
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.URLDecoder
import java.util.concurrent.ConcurrentHashMap

/**
 * The OAuth exchange is the one flow whose request shape the server matches by
 * exact string — `redirect_uri` at both authorize and token time — so these assert
 * the wire form, not just that a call succeeded.
 */
class OAuthTest {
	@get:Rule
	val serverRule = MockWebServerRule()

	/** A second server for the barrier-based race tests: [RecordingServer.Gate] can
	 * hold the `/oauth/token` response in flight while a second caller arrives, which
	 * [MockWebServerRule]'s enqueue model can't express. */
	@get:Rule
	val recording = RecordingServer()

	private val server: MockWebServer get() = serverRule.server

	/** Hosts the single-flight refresh, standing in for the application-scoped scope
	 * production supplies. Real IO so a refresh held at a [Gate] blocks a real thread
	 * while the test coordinates; cancelled after each test. */
	private val refreshScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

	@After
	fun cancelRefreshScope() {
		refreshScope.cancel()
	}

	private class RecordingTokenStorage : TokenStorage {
		// Concurrent because the race tests read and write the store from the refresh
		// coroutine, the server's own dispatcher thread and the test thread at once.
		val stored = ConcurrentHashMap<TokenKey, String>()

		override fun readValue(key: TokenKey): Result<String?> = Result.success(stored[key])

		override fun setValue(key: TokenKey, value: String) {
			stored[key] = value
		}

		override fun removeValue(key: TokenKey) {
			stored.remove(key)
		}
	}

	private val storage = RecordingTokenStorage()
	private val store = TokenStore(storage)

	private val nativeUserAgent = "Readplace/909090 Android/OAUTH-TEST-UA"

	/** A session is the pair: the store answers nothing at all until both tokens are
	 * present, so a test that needs "a stored refresh token" stores a whole pair. */
	private fun signedInWith(refreshToken: String) {
		store.save(OAuthTokens(AccessToken("stored-access"), RefreshToken(refreshToken)))
	}

	private fun oauth(): OAuth =
		OAuth(
			baseUrl = server.url("/").toString().removeSuffix("/"),
			store = store,
			http = OkHttpClient(),
			nativeUserAgent = nativeUserAgent,
			refreshScope = refreshScope,
		)

	/** An OAuth pointed at the [Gate]-capable [recording] server, for the race tests. */
	private fun oauthAt(server: RecordingServer): OAuth =
		OAuth(
			baseUrl = server.baseUrl,
			store = store,
			http = OkHttpClient(),
			nativeUserAgent = nativeUserAgent,
			refreshScope = refreshScope,
		)

	/** A port nothing is listening on, so the call fails in the transport rather than
	 * at the server — the only way to reach the best-effort catch. */
	private fun unusedPort(): Int = ServerSocket(0).use { it.localPort }

	private fun formOf(body: String): Map<String, String> =
		body.split("&")
			.filter { it.isNotEmpty() }
			.associate { pair ->
				val (name, value) = pair.split("=", limit = 2)
				URLDecoder.decode(name, "UTF-8") to URLDecoder.decode(value, "UTF-8")
			}

	// region authorize URL

	@Test
	fun `the login authorize URL carries every parameter the server requires`() {
		val request = oauth().makeNativeLoginAuthorizationRequest()
		val url = request.url.toHttpUrl()

		assertEquals("/oauth/authorize", url.encodedPath)
		assertEquals("android-app", url.queryParameter("client_id"))
		assertEquals("readplace://oauth-callback/android", url.queryParameter("redirect_uri"))
		assertEquals("code", url.queryParameter("response_type"))
		assertEquals("S256", url.queryParameter("code_challenge_method"))
		assertEquals("login", url.queryParameter("screen_hint"))
		assertEquals(request.state, url.queryParameter("state"))
		assertEquals(
			"the challenge must be the S256 hash of the verifier the caller will later post",
			Pkce.challengeFor(request.codeVerifier),
			url.queryParameter("code_challenge"),
		)
	}

	@Test
	fun `the signup authorize URL differs from login only by its screen hint`() {
		val url = oauth().makeSignupAuthorizationRequest().url.toHttpUrl()

		assertEquals("signup", url.queryParameter("screen_hint"))
		assertEquals("android-app", url.queryParameter("client_id"))
		assertEquals("readplace://oauth-callback/android", url.queryParameter("redirect_uri"))
		assertEquals("code", url.queryParameter("response_type"))
		assertEquals("S256", url.queryParameter("code_challenge_method"))
	}

	@Test
	fun `the redirect URI travels with the request so the exchange posts the same string back`() {
		val request = oauth().makeNativeLoginAuthorizationRequest()

		assertEquals(request.redirectUri, request.url.toHttpUrl().queryParameter("redirect_uri"))
		assertEquals("readplace://oauth-callback/android", oauth().nativeRedirectUri)
	}

	@Test
	fun `each authorize request mints a fresh verifier and state`() {
		val client = oauth()
		val first = client.makeNativeLoginAuthorizationRequest()
		val second = client.makeNativeLoginAuthorizationRequest()

		assertNotEquals(first.codeVerifier, second.codeVerifier)
		assertNotEquals(first.state, second.state)
	}

	// endregion

	// region code exchange

	@Test
	fun `a code exchange posts the PKCE form and stores both tokens`() = runTest {
		server.enqueue(
			MockResponse(
				code = 200,
				body = """{"access_token":"at-1","refresh_token":"rt-1"}""",
			),
		)

		val tokens = oauth().exchangeCode(
			code = "the-code",
			verifier = "the-verifier",
			redirectUri = "readplace://oauth-callback/android",
		)

		val recorded = server.takeRequest()
		assertEquals("POST", recorded.method)
		assertEquals("/oauth/token", recorded.url.encodedPath)
		assertEquals("application/x-www-form-urlencoded", recorded.headers["Content-Type"])
		assertEquals("application/json", recorded.headers["Accept"])
		assertEquals(
			"the exact build-numbered native UA travels once, never OkHttp's default",
			listOf(nativeUserAgent),
			recorded.headers.values("User-Agent"),
		)
		assertNotEquals(
			"the native UA is not the spoofed browser UA the capture WebView sends",
			AppConfig.WEB_VIEW_USER_AGENT,
			recorded.headers["User-Agent"],
		)
		assertEquals(
			mapOf(
				"grant_type" to "authorization_code",
				"code" to "the-code",
				"redirect_uri" to "readplace://oauth-callback/android",
				"client_id" to "android-app",
				"code_verifier" to "the-verifier",
			),
			formOf(recorded.body?.utf8().orEmpty()),
		)
		assertEquals(OAuthTokens(AccessToken("at-1"), RefreshToken("rt-1")), tokens)
		assertEquals(OAuthTokens(AccessToken("at-1"), RefreshToken("rt-1")), store.tokens)
	}

	@Test
	fun `a non-200 exchange reports the status and stores nothing`() = runTest {
		server.enqueue(MockResponse(code = 400, body = """{"error":"invalid_grant"}"""))

		try {
			oauth().exchangeCode("c", "v", "readplace://oauth-callback/android")
			fail("a rejected exchange must not resolve")
		} catch (error: OAuthError.TokenExchangeFailed) {
			assertEquals(400, error.status)
			assertEquals("Token exchange failed (HTTP 400).", error.message)
		}
		assertEquals(emptyMap<TokenKey, String>(), storage.stored)
	}

	@Test
	fun `an exchange whose body is not JSON is a malformed response`() = runTest {
		server.enqueue(MockResponse(code = 200, body = "not json at all"))

		try {
			oauth().exchangeCode("c", "v", "r")
			fail("an unparseable body must not resolve")
		} catch (error: OAuthError.MalformedResponse) {
			assertEquals("The server returned an unexpected token response.", error.message)
		}
	}

	@Test
	fun `an exchange whose body parses as JSON but is not an object is a malformed response`() =
		runTest {
			// Distinct from the unparseable case: this reaches the parser cleanly and is
			// rejected by shape, so it exercises the other arm of the same guard.
			server.enqueue(MockResponse(code = 200, body = """["access_token"]"""))

			try {
				oauth().exchangeCode("c", "v", "r")
				fail("a JSON array is not a token response")
			} catch (_: OAuthError.MalformedResponse) {
			}
		}

	@Test
	fun `an exchange missing the access token is a malformed response`() = runTest {
		server.enqueue(MockResponse(code = 200, body = """{"refresh_token":"rt"}"""))

		try {
			oauth().exchangeCode("c", "v", "r")
			fail("a body with no access token must not resolve")
		} catch (_: OAuthError.MalformedResponse) {
		}
	}

	@Test
	fun `an exchange missing the refresh token is a malformed response, since none is stored yet`() =
		runTest {
			server.enqueue(MockResponse(code = 200, body = """{"access_token":"at"}"""))

			try {
				oauth().exchangeCode("c", "v", "r")
				fail("a first exchange has no refresh token to fall back to")
			} catch (_: OAuthError.MalformedResponse) {
			}
		}

	@Test
	fun `a non-string access token is a malformed response`() = runTest {
		server.enqueue(MockResponse(code = 200, body = """{"access_token":42,"refresh_token":"rt"}"""))

		try {
			oauth().exchangeCode("c", "v", "r")
			fail("a numeric token is not a token")
		} catch (_: OAuthError.MalformedResponse) {
		}
	}

	@Test
	fun `a non-string refresh token is a malformed response rather than silently ignored`() = runTest {
		signedInWith(refreshToken = "rt-1")
		server.enqueue(MockResponse(code = 200, body = """{"access_token":"at","refresh_token":7}"""))

		try {
			oauth().exchangeCode("c", "v", "r")
			fail("a present-but-wrong-typed refresh token must not fall through to the stored one")
		} catch (_: OAuthError.MalformedResponse) {
		}
		assertEquals(OAuthTokens(AccessToken("stored-access"), RefreshToken("rt-1")), store.tokens)
	}

	// endregion

	// region refresh

	@Test
	fun `a refresh posts the stored token and returns the new access token`() = runTest {
		signedInWith(refreshToken = "rt-1")
		server.enqueue(
			MockResponse(code = 200, body = """{"access_token":"at-2","refresh_token":"rt-2"}"""),
		)

		val accessToken = oauth().refresh()

		val recorded = server.takeRequest()
		assertEquals("POST", recorded.method)
		assertEquals("/oauth/token", recorded.url.encodedPath)
		assertEquals("application/x-www-form-urlencoded", recorded.headers["Content-Type"])
		assertEquals("application/json", recorded.headers["Accept"])
		assertEquals(
			"the refresh request carries the same build-numbered native UA, exactly once",
			listOf(nativeUserAgent),
			recorded.headers.values("User-Agent"),
		)
		assertEquals(
			"grant_type=refresh_token&refresh_token=rt-1&client_id=android-app",
			recorded.body?.utf8(),
		)
		assertEquals(AccessToken("at-2"), accessToken)
		assertEquals(OAuthTokens(AccessToken("at-2"), RefreshToken("rt-2")), store.tokens)
	}

	@Test
	fun `a refresh response that omits a new refresh token keeps the stored one`() = runTest {
		signedInWith(refreshToken = "rt-1")
		server.enqueue(MockResponse(code = 200, body = """{"access_token":"at-2"}"""))

		assertEquals(AccessToken("at-2"), oauth().refresh())
		assertEquals(
			"the server rotates refresh tokens only sometimes; dropping the stored one on a " +
				"non-rotating response would sign the user out at the next refresh",
			OAuthTokens(AccessToken("at-2"), RefreshToken("rt-1")),
			store.tokens,
		)
	}

	@Test
	fun `a null refresh token in the response also keeps the stored one`() = runTest {
		signedInWith(refreshToken = "rt-1")
		server.enqueue(
			MockResponse(code = 200, body = """{"access_token":"at-2","refresh_token":null}"""),
		)

		assertEquals(AccessToken("at-2"), oauth().refresh())
		assertEquals(OAuthTokens(AccessToken("at-2"), RefreshToken("rt-1")), store.tokens)
	}

	@Test
	fun `a refresh with nothing stored fails before any request is made`() = runTest {
		try {
			oauth().refresh()
			fail("there is nothing to refresh with")
		} catch (error: OAuthError.NoRefreshToken) {
			assertEquals("No refresh token is stored. Please sign in again.", error.message)
		}
		assertEquals(0, server.requestCount)
	}

	@Test
	fun `an HTTP 401 invalid_grant is a nonterminal refresh failure that keeps the stored pair`() = runTest {
		// The terminal rule is HTTP 400 `invalid_grant`; a 401 (even carrying the same
		// error body) is not the server rejecting the token outright, so it is a
		// retryable failure that leaves the reader signed in.
		signedInWith(refreshToken = "rt-1")
		server.enqueue(MockResponse(code = 401, body = """{"error":"invalid_grant"}"""))

		try {
			oauth().refresh()
			fail("a rejected refresh must not resolve")
		} catch (error: OAuthError.RefreshFailed) {
			assertEquals("Could not refresh the session. Please try again.", error.message)
		}
		assertEquals(OAuthTokens(AccessToken("stored-access"), RefreshToken("rt-1")), store.tokens)
	}

	@Test
	fun `an HTTP 400 invalid_grant discards the rejected refresh token`() = runTest {
		signedInWith(refreshToken = "rt-1")
		server.enqueue(MockResponse(code = 400, body = """{"error":"invalid_grant"}"""))

		try {
			oauth().refresh()
			fail("a rejected refresh token must not resolve")
		} catch (error: OAuthError.NoRefreshToken) {
			assertEquals("No refresh token is stored. Please sign in again.", error.message)
		}
		assertNull("the server rejected this token outright, so it is discarded", store.tokens)
	}

	@Test
	fun `an HTTP 400 without invalid_grant keeps the stored pair`() = runTest {
		signedInWith(refreshToken = "rt-1")
		server.enqueue(MockResponse(code = 400, body = """{"error":"invalid_request"}"""))

		try {
			oauth().refresh()
			fail("a 400 that is not invalid_grant must not resolve")
		} catch (_: OAuthError.RefreshFailed) {
		}
		assertEquals(
			"only a decoded invalid_grant discards the token; any other 400 is retryable",
			OAuthTokens(AccessToken("stored-access"), RefreshToken("rt-1")),
			store.tokens,
		)
	}

	@Test
	fun `a 503 refresh keeps the stored pair`() = runTest {
		signedInWith(refreshToken = "rt-1")
		server.enqueue(MockResponse(code = 503, body = "{}"))

		try {
			oauth().refresh()
			fail("a transient refresh failure must not resolve")
		} catch (_: OAuthError.RefreshFailed) {
		}
		assertEquals(OAuthTokens(AccessToken("stored-access"), RefreshToken("rt-1")), store.tokens)
	}

	@Test
	fun `a delayed refresh adopts credentials another refresh already won without a second request`() = runTest {
		signedInWith(refreshToken = "rt-1")
		server.enqueue(MockResponse(code = 200, body = """{"access_token":"at-2","refresh_token":"rt-2"}"""))
		val oauth = oauth()
		val snapshot = oauth.snapshot()

		oauth.refresh(after = snapshot)
		// The same failed snapshot, replayed: the store now holds the winner, so this
		// adopts it rather than posting a second refresh (only one response is enqueued).
		val adopted = oauth.refresh(after = snapshot)

		assertEquals(AccessToken("at-2"), adopted.tokens.accessToken)
		assertEquals("the second caller reuses the winner, making no second refresh request", 1, server.requestCount)
	}

	@Test
	fun `concurrent callers share one refresh and cancelling one does not cancel it`() = runTest {
		signedInWith(refreshToken = "rt-1")
		val oauth = oauthAt(recording)
		val snapshot = oauth.snapshot()
		val gate = Gate()
		recording.handle { record ->
			when (record.path) {
				"/oauth/token" -> gate.holding(Stub.json(200, """{"access_token":"at-2","refresh_token":"rt-2"}"""))
				else -> Stub.json(404, "{}")
			}
		}

		val first = launch { runCatching { oauth.refresh(after = snapshot) } }
		withContext(Dispatchers.IO) { gate.awaitArrival() }
		first.cancel()
		val second = async { oauth.refresh(after = snapshot) }
		gate.release()
		val result = second.await()
		first.join()

		assertEquals("the surviving caller gets the refreshed access token", AccessToken("at-2"), result.tokens.accessToken)
		assertEquals("both callers coalesce onto exactly one refresh request", 1, recording.records("/oauth/token").size)
	}

	@Test
	fun `a clear during an in-flight refresh cannot restore the tokens`() = runTest {
		signedInWith(refreshToken = "rt-1")
		val oauth = oauthAt(recording)
		val gate = Gate()
		recording.handle { record ->
			when (record.path) {
				"/oauth/token" -> gate.holding(Stub.json(200, """{"access_token":"late","refresh_token":"late-r"}"""))
				else -> Stub.json(404, "{}")
			}
		}

		val refresh = async { runCatching { oauth.refresh() } }
		withContext(Dispatchers.IO) { gate.awaitArrival() }
		oauth.clear()
		gate.release()
		refresh.await()

		assertNull("a refresh that returns after a logout must not resurrect the session", store.tokens)
	}

	@Test
	fun `clearIfUnchanged preserves a replacement pair and clears the current one`() = runTest {
		signedInWith(refreshToken = "rt-1")
		val oauth = oauth()
		val rejected = store.tokens
		val replacement = OAuthTokens(AccessToken("replacement"), RefreshToken("replacement-r"))
		store.save(replacement)

		oauth.clearIfUnchanged(rejected)
		assertEquals("a replacement login that landed first is not erased by a stale clear", replacement, store.tokens)

		oauth.clearIfUnchanged(replacement)
		assertNull("clearing against the current pair does clear it", store.tokens)
	}

	@Test
	fun `a refresh adopts a pair an overlapping refresh stored, even on a rejection`() = runTest {
		signedInWith(refreshToken = "rt-1")
		val oauth = oauthAt(recording)
		recording.handle { record ->
			when (record.path) {
				// Another caller's refresh wins while this one is on the wire, then this
				// one comes back rejected — the adopted winner must stand over the rejection.
				"/oauth/token" -> {
					store.save(OAuthTokens(AccessToken("winner"), RefreshToken("winner-r")))
					Stub.json(400, """{"error":"invalid_grant"}""")
				}
				else -> Stub.json(404, "{}")
			}
		}

		val accessToken = oauth.refresh()

		assertEquals("the winner is adopted, not the rejection acted on", AccessToken("winner"), accessToken)
		assertEquals(
			"a rejection cannot discard a pair this refresh no longer owns",
			OAuthTokens(AccessToken("winner"), RefreshToken("winner-r")),
			store.tokens,
		)
	}

	@Test
	fun `a refresh that fails in transport keeps the stored pair`() = runTest {
		signedInWith(refreshToken = "rt-1")
		val unreachable = OAuth(
			baseUrl = "http://127.0.0.1:${unusedPort()}",
			store = store,
			http = OkHttpClient(),
			nativeUserAgent = nativeUserAgent,
			refreshScope = refreshScope,
		)

		try {
			unreachable.refresh()
			fail("a transport failure must not resolve")
		} catch (_: OAuthError.RefreshFailed) {
		}
		assertEquals(OAuthTokens(AccessToken("stored-access"), RefreshToken("rt-1")), store.tokens)
	}

	@Test
	fun `an HTTP 400 with a non-JSON body keeps the stored pair`() = runTest {
		signedInWith(refreshToken = "rt-1")
		server.enqueue(MockResponse(code = 400, body = "not json at all"))

		try {
			oauth().refresh()
			fail("a malformed refusal must not resolve")
		} catch (_: OAuthError.RefreshFailed) {
		}
		assertEquals(
			"a 400 the client cannot decode as invalid_grant is retryable, not a discard",
			OAuthTokens(AccessToken("stored-access"), RefreshToken("rt-1")),
			store.tokens,
		)
	}

	@Test
	fun `a refresh for a superseded generation reports a session change`() = runTest {
		signedInWith(refreshToken = "rt-1")
		val oauth = oauth()
		val stale = oauth.snapshot()
		// A new sign-in rotates the generation and stores a fresh pair.
		server.enqueue(MockResponse(code = 200, body = """{"access_token":"new","refresh_token":"new-r"}"""))
		oauth.exchangeCode(code = "c", verifier = "v", redirectUri = "readplace://oauth-callback/android")

		try {
			oauth.refresh(after = stale)
			fail("a refresh for the superseded session must not resolve")
		} catch (_: OAuthError.SessionChanged) {
		}
		assertEquals("the fenced refresh makes no token request of its own", 1, server.requestCount)
		assertEquals(OAuthTokens(AccessToken("new"), RefreshToken("new-r")), store.tokens)
	}

	@Test
	fun `an exchange that completes after a logout cannot overwrite the store`() = runTest {
		val oauth = oauthAt(recording)
		val gate = Gate()
		recording.handle { record ->
			when (record.path) {
				"/oauth/token" -> gate.holding(Stub.json(200, """{"access_token":"late","refresh_token":"late-r"}"""))
				else -> Stub.json(404, "{}")
			}
		}

		val exchange = async { runCatching { oauth.exchangeCode("c", "v", "readplace://oauth-callback/android") } }
		withContext(Dispatchers.IO) { gate.awaitArrival() }
		oauth.clear()
		gate.release()
		exchange.await()

		assertNull("a code exchange that returns after a logout must not populate the store", store.tokens)
	}

	@Test
	fun `a refresh whose body is malformed is a malformed response`() = runTest {
		signedInWith(refreshToken = "rt-1")
		server.enqueue(MockResponse(code = 200, body = "["))

		try {
			oauth().refresh()
			fail("an unparseable refresh body must not resolve")
		} catch (_: OAuthError.MalformedResponse) {
		}
	}

	// endregion

	// region revoke

	@Test
	fun `a revoke posts the stored token as JSON and clears the store`() = runTest {
		signedInWith(refreshToken = "rt-1")
		server.enqueue(MockResponse(code = 200, body = ""))

		oauth().revoke()

		val recorded = server.takeRequest()
		assertEquals("POST", recorded.method)
		assertEquals("/oauth/revoke", recorded.url.encodedPath)
		assertEquals("application/json", recorded.headers["Content-Type"])
		assertEquals("""{"token":"rt-1"}""", recorded.body?.utf8())
		assertEquals(
			"revoke builds its own request, so it must set the native UA independently",
			listOf(nativeUserAgent),
			recorded.headers.values("User-Agent"),
		)
		assertEquals(emptyMap<TokenKey, String>(), storage.stored)
		assertNull(store.tokens)
	}

	@Test
	fun `a revoke the server rejects still clears the store`() = runTest {
		signedInWith(refreshToken = "rt-1")
		server.enqueue(MockResponse(code = 500, body = ""))

		oauth().revoke()

		assertNull(
			"sign-out is local-first; the server's answer cannot keep the user signed in",
			store.tokens,
		)
	}

	@Test
	fun `a revoke the network never delivers still clears the store`() = runTest {
		// Sign-out has to work on a plane. The revoke is best-effort by design, so a
		// transport failure must land in the same place a 500 does: locally signed out.
		signedInWith(refreshToken = "rt-1")
		val unreachable = OAuth(
			baseUrl = "http://127.0.0.1:${unusedPort()}",
			store = store,
			http = OkHttpClient(),
			nativeUserAgent = nativeUserAgent,
			refreshScope = refreshScope,
		)

		unreachable.revoke()

		assertEquals(emptyMap<TokenKey, String>(), storage.stored)
		assertNull(store.tokens)
	}

	@Test
	fun `a revoke with nothing stored clears without calling the server`() = runTest {
		oauth().revoke()

		assertEquals(0, server.requestCount)
		assertEquals(emptyMap<TokenKey, String>(), storage.stored)
		assertNull(store.tokens)
	}

	// endregion

	// region native cleartext policy

	/** A client whose only non-default is the policy under test, permitting cleartext
	 * to [cleartextHost] alone. OAuth follows redirects itself (unlike the API's
	 * hand-walk), so a network interceptor is what sees each automatic hop. */
	private fun interceptingClient(cleartextHost: String): OkHttpClient =
		OkHttpClient.Builder()
			.addNetworkInterceptor(NativeCleartextPolicy(setOf(cleartextHost)))
			.build()

	@Test
	fun `an automatic redirect that leaves the permitted host for cleartext is refused`() = runTest {
		signedInWith(refreshToken = "rt-1")
		val target = MockWebServer()
		target.start(InetAddress.getByName("127.0.0.1"), 0)
		try {
			target.enqueue(
				MockResponse.Builder()
					.code(303)
					.addHeader("Location", "http://127.0.0.1:${target.port}/oauth/token")
					.build(),
			)
			val oauth = OAuth(
				baseUrl = "http://localhost:${target.port}",
				store = store,
				http = interceptingClient("localhost"),
				nativeUserAgent = nativeUserAgent,
				refreshScope = refreshScope,
			)

			try {
				oauth.refresh()
				fail("a refresh whose redirect leaves the permitted host must not resolve")
			} catch (_: OAuthError.RefreshFailed) {
				// The policy blocks the forbidden hop with an IOException; a refresh maps
				// that transport failure to the nonterminal RefreshFailed. The security
				// property — the forbidden hop is never sent — is asserted below.
			}

			assertEquals("the forbidden hop must never be sent", 1, target.requestCount)
			assertEquals(
				"a refused refresh leaves the stored pair intact",
				OAuthTokens(AccessToken("stored-access"), RefreshToken("rt-1")),
				store.tokens,
			)
		} finally {
			target.close()
		}
	}

	@Test
	fun `a 307 that replays the token POST onto cleartext is refused before the form is resent`() = runTest {
		val target = MockWebServer()
		target.start(InetAddress.getByName("127.0.0.1"), 0)
		try {
			target.enqueue(
				MockResponse.Builder()
					.code(307)
					.addHeader("Location", "http://127.0.0.1:${target.port}/oauth/token")
					.build(),
			)
			val oauth = OAuth(
				baseUrl = "http://localhost:${target.port}",
				store = store,
				http = interceptingClient("localhost"),
				nativeUserAgent = nativeUserAgent,
				refreshScope = refreshScope,
			)

			try {
				oauth.exchangeCode("the-code", "the-verifier", "readplace://oauth-callback/android")
				fail("a 307 replay onto a forbidden host must not resolve")
			} catch (error: IOException) {
				assertTrue(error.message.orEmpty().contains("not permitted for native requests"))
			}

			assertEquals("the replayed form must never reach the forbidden host", 1, target.requestCount)
			val origin = target.takeRequest()
			assertEquals("POST", origin.method)
			assertEquals("/oauth/token", origin.url.encodedPath)
		} finally {
			target.close()
		}
	}

	// endregion
}
