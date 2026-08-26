package com.readplace.android.core

import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.junit4.MockWebServerRule
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import java.net.ServerSocket
import java.net.URLDecoder

/**
 * The OAuth exchange is the one flow whose request shape the server matches by
 * exact string — `redirect_uri` at both authorize and token time — so these assert
 * the wire form, not just that a call succeeded.
 */
class OAuthTest {
	@get:Rule
	val serverRule = MockWebServerRule()

	private val server: MockWebServer get() = serverRule.server

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

	private val storage = RecordingTokenStorage()
	private val store = TokenStore(storage)

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
	fun `a rejected refresh reports a refresh failure and keeps the stored pair`() = runTest {
		signedInWith(refreshToken = "rt-1")
		server.enqueue(MockResponse(code = 401, body = """{"error":"invalid_grant"}"""))

		try {
			oauth().refresh()
			fail("a rejected refresh must not resolve")
		} catch (error: OAuthError.RefreshFailed) {
			assertEquals("Could not refresh the session. Please sign in again.", error.message)
		}
		assertEquals(OAuthTokens(AccessToken("stored-access"), RefreshToken("rt-1")), store.tokens)
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
}
