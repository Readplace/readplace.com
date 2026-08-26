package com.readplace.android.core

import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.junit4.MockWebServerRule
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.io.IOException
import java.net.ServerSocket
import java.net.URLDecoder

/**
 * The in-app auth core's three outcomes, and the callback checks that stand
 * between a captured redirect and a token request. The distinctions that matter: a
 * user dismissing the presentation must not reach the sign-in screen as an error,
 * and neither a dismissal, a failed presentation nor a rejected callback may
 * exchange a code.
 */
class WebAuthFlowTest {
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

	private val store = TokenStore(RecordingTokenStorage())

	private fun serverBaseUrl(): String = server.url("/").toString().removeSuffix("/")

	private fun oauthAt(baseUrl: String): OAuth =
		OAuth(baseUrl = baseUrl, store = store, http = OkHttpClient())

	private fun request(): AuthorizationRequest =
		oauthAt(serverBaseUrl()).makeNativeLoginAuthorizationRequest()

	private fun flow(present: suspend (String) -> WebAuthPresentation): WebAuthFlow =
		initWebAuthFlow(present, oauthAt(serverBaseUrl()))

	private fun callback(query: String): WebAuthPresentation =
		WebAuthPresentation.Returned("${AppConfig.NATIVE_CALLBACK_URL}?$query")

	private fun tokensMinted() {
		server.enqueue(
			MockResponse(
				code = 200,
				body = """{"access_token":"fresh-access","refresh_token":"fresh-refresh"}""",
			),
		)
	}

	private fun failureOf(outcome: Result<Unit>?): Throwable =
		outcome?.exceptionOrNull() ?: throw AssertionError("expected a failure, got $outcome")

	/** A port nothing is listening on, so the exchange fails in the transport rather
	 * than at the server. */
	private fun unusedPort(): Int = ServerSocket(0).use { it.localPort }

	private fun formOf(body: String): Map<String, String> =
		body.split("&")
			.filter { it.isNotEmpty() }
			.associate { pair ->
				val (name, value) = pair.split("=", limit = 2)
				URLDecoder.decode(name, "UTF-8") to URLDecoder.decode(value, "UTF-8")
			}

	// region the three outcomes

	@Test
	fun `the returned callback is exchanged with the same request's PKCE secrets`() = runTest {
		val request = request()
		tokensMinted()

		val result = flow { callback("code=abc&state=${request.state}") }.start(request)

		assertEquals(Result.success(Unit), result)
		val recorded = server.takeRequest()
		assertEquals("POST", recorded.method)
		assertEquals("/oauth/token", recorded.url.encodedPath)
		val form = formOf(recorded.body?.utf8().orEmpty())
		assertEquals("authorization_code", form["grant_type"])
		assertEquals("abc", form["code"])
		assertEquals(
			"the verifier that signed the authorize request must be the one exchanged — " +
				"it lives in this call, not on disk",
			request.codeVerifier,
			form["code_verifier"],
		)
		assertEquals(AppConfig.NATIVE_CALLBACK_URL, form["redirect_uri"])
		assertEquals("android-app", form["client_id"])
		assertEquals(
			"the pair must be persisted for the share target",
			OAuthTokens(AccessToken("fresh-access"), RefreshToken("fresh-refresh")),
			store.tokens,
		)
	}

	@Test
	fun `the authorize URL is presented verbatim`() = runTest {
		val request = oauthAt(AppConfig.serverBaseUrl).makeNativeLoginAuthorizationRequest()
		var presented: String? = null
		val flow = initWebAuthFlow(
			present = { url ->
				presented = url
				WebAuthPresentation.Dismissed
			},
			oauth = oauthAt(AppConfig.serverBaseUrl),
		)

		flow.start(request)

		assertEquals(request.url, presented)
		assertEquals(
			"auth is presented in-app at the server's own URL — never rewritten to a browser's " +
				"custom scheme",
			AppConfig.serverBaseUrl.toHttpUrl().scheme,
			presented?.toHttpUrl()?.scheme,
		)
	}

	@Test
	fun `a dismissed presentation reports nothing and exchanges no code`() = runTest {
		val result = flow { WebAuthPresentation.Dismissed }.start(request())

		assertNull(
			"dismissing the presentation is a choice, not an error the sign-in screen should show",
			result,
		)
		assertEquals(0, server.requestCount)
	}

	@Test
	fun `a failed presentation surfaces the presenter's account and exchanges no code`() = runTest {
		val presentation = WebAuthPresentation.Failure(
			AuthFlowError.PresentationFailed.SIGN_IN_PAGE_DID_NOT_OPEN,
		)

		val error = failureOf(flow { presentation }.start(request()))

		assertTrue(error is AuthFlowError.PresentationFailed)
		assertEquals("Could not open the sign-in page. Please try again.", error.message)
		assertEquals(0, server.requestCount)
	}

	@Test
	fun `a failed presentation keeps the presenter's own wording`() = runTest {
		val presentation = WebAuthPresentation.Failure("No browser on this device can open it.")

		val error = failureOf(flow { presentation }.start(request()))

		assertEquals("No browser on this device can open it.", error.message)
	}

	// endregion

	// region the exchange

	@Test
	fun `a failed exchange is reported as a failure`() = runTest {
		val request = request()
		server.enqueue(MockResponse(code = 400, body = """{"error":"invalid_grant"}"""))

		val error = failureOf(flow { callback("code=abc&state=${request.state}") }.start(request))

		assertTrue(error is OAuthError.TokenExchangeFailed)
		assertEquals("Token exchange failed (HTTP 400).", error.message)
		assertNull("a rejected exchange leaves the account signed out", store.tokens)
	}

	@Test
	fun `an exchange the network never delivers is reported as a failure`() = runTest {
		val unreachable = oauthAt("http://127.0.0.1:${unusedPort()}")
		val request = unreachable.makeNativeLoginAuthorizationRequest()
		val flow = initWebAuthFlow({ callback("code=abc&state=${request.state}") }, unreachable)

		val error = failureOf(flow.start(request))

		assertTrue(error is IOException)
		assertNull(store.tokens)
	}

	@Test
	fun `a percent-encoded callback value is decoded before it is exchanged`() = runTest {
		val request = request()
		tokensMinted()

		flow { callback("code=a%2Fb%3Dc&state=${request.state}") }.start(request)

		assertEquals("a/b=c", formOf(server.takeRequest().body?.utf8().orEmpty())["code"])
	}

	@Test
	fun `a percent-encoded space in a callback value is decoded`() = runTest {
		val request = request()
		tokensMinted()

		flow { callback("code=a%20b&state=${request.state}") }.start(request)

		assertEquals("a b", formOf(server.takeRequest().body?.utf8().orEmpty())["code"])
	}

	@Test
	fun `a token store that cannot persist the minted pair reports the failure`() = runTest {
		val cannotPersist = object : TokenStorage {
			override fun readValue(key: TokenKey): Result<String?> = Result.success(null)

			override fun setValue(key: TokenKey, value: String) {
				throw IllegalStateException("keystore unavailable")
			}

			override fun removeValue(key: TokenKey) {
			}
		}
		val oauth = OAuth(baseUrl = serverBaseUrl(), store = TokenStore(cannotPersist), http = OkHttpClient())
		val request = oauth.makeNativeLoginAuthorizationRequest()
		tokensMinted()

		val error = failureOf(initWebAuthFlow({ callback("code=abc&state=${request.state}") }, oauth).start(request))

		assertTrue(
			"a pair the Keystore refused to persist reaches the sign-in screen as a failure, not as a crash out of the flow",
			error is IllegalStateException,
		)
		assertEquals("keystore unavailable", error.message)
		assertEquals("the exchange itself happened — it is the persisting that failed", 1, server.requestCount)
	}

	// endregion

	// region the callback checks

	@Test
	fun `a callback carrying an error param is denied without exchanging`() = runTest {
		val request = request()

		val denied = flow { callback("error=access_denied&state=${request.state}") }

		val error = failureOf(denied.start(request))

		assertEquals("access_denied", (error as? AuthFlowError.Denied)?.reason)
		assertEquals("Authorization was denied (access_denied).", error.message)
		assertEquals("a denied authorization exchanges no code", 0, server.requestCount)
	}

	@Test
	fun `a plus in a callback value is a literal plus, not a space`() = runTest {
		val request = request()

		val error = failureOf(flow { callback("error=access+denied&state=${request.state}") }.start(request))

		assertEquals(
			"the callback is a URL query, not a form body: only percent escapes are decoded, so a plus stays itself",
			"access+denied",
			(error as? AuthFlowError.Denied)?.reason,
		)
		assertEquals("Authorization was denied (access+denied).", error.message)
		assertEquals(0, server.requestCount)
	}

	@Test
	fun `a callback without a code is missing code without exchanging`() = runTest {
		val request = request()

		val error = failureOf(flow { callback("state=${request.state}") }.start(request))

		assertTrue(error is AuthFlowError.MissingCode)
		assertEquals("No authorization code was returned.", error.message)
		assertEquals(0, server.requestCount)
	}

	@Test
	fun `a callback whose state is not the request's is rejected without exchanging`() = runTest {
		val error = failureOf(flow { callback("code=abc&state=WRONG") }.start(request()))

		assertTrue(error is AuthFlowError.StateMismatch)
		assertEquals("Security check failed (state mismatch).", error.message)
		assertEquals("a rejected callback must not exchange the code", 0, server.requestCount)
		assertNull(store.tokens)
	}

	@Test
	fun `a bare query name carries no value`() = runTest {
		val request = request()

		val error = failureOf(flow { callback("code&state=${request.state}") }.start(request))

		assertTrue(error is AuthFlowError.MissingCode)
		assertEquals(0, server.requestCount)
	}

	@Test
	fun `a callback with no query at all carries no code`() = runTest {
		val bare = WebAuthPresentation.Returned(AppConfig.NATIVE_CALLBACK_URL)

		val error = failureOf(flow { bare }.start(request()))

		assertTrue(error is AuthFlowError.MissingCode)
		assertEquals(0, server.requestCount)
	}

	@Test
	fun `a callback that is not a URI carries no code`() = runTest {
		val request = request()

		val error = failureOf(flow { callback("code=a b&state=${request.state}") }.start(request))

		assertTrue(error is AuthFlowError.MissingCode)
		assertEquals(0, server.requestCount)
	}

	// endregion
}
