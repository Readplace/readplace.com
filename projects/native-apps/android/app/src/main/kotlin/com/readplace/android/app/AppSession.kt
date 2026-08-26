package com.readplace.android.app

import com.readplace.android.core.AuthFlowError
import com.readplace.android.core.AuthorizationRequest
import com.readplace.android.core.EphemeralCookieJar
import com.readplace.android.core.OAuth
import com.readplace.android.core.OAuthError
import com.readplace.android.core.ReadplaceApi
import com.readplace.android.core.ShareArtifacts
import com.readplace.android.core.SloganSource
import com.readplace.android.core.TokenStore
import com.readplace.android.core.WebAuthFlow
import com.readplace.android.core.initSloganSource
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import java.io.IOException
import java.net.URI
import java.net.URISyntaxException

/**
 * Removes the reader's authenticated traces from the process-wide WebView store
 * on sign-out: every cookie scoped to the app's own server host (whatever the
 * server named the session cookie), so a server cookie rename needs no app
 * release, plus every non-cookie data type so the signed-out account's reading
 * history doesn't stay on disk. Scoping the cookie wipe to the server host leaves
 * cookies for other origins untouched.
 */
fun interface WebDataWiper {
	suspend fun wipe(serverHost: String)
}

/**
 * The API session's own isolated cookie jar — never the WebView's process-wide
 * CookieManager — cleared wholesale on sign-out.
 */
private class SessionCookieJar : CookieJar {
	@Volatile
	private var held = EphemeralCookieJar()

	override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
		held.saveFromResponse(url, cookies)
	}

	override fun loadForRequest(url: HttpUrl): List<Cookie> = held.loadForRequest(url)

	fun clear() {
		held = EphemeralCookieJar()
	}
}

/**
 * App-wide auth/session state, plus factories so screens reach the API and OAuth
 * with current config rather than constructing them with stale values.
 *
 * The API/OAuth clients keep their cookie jar in an isolated, in-memory store
 * rather than the process-wide WebView CookieManager — the minted reader session
 * cookie must not linger in a shared jar where it would outlive a sign-out — and
 * cache nothing, so the app's list views always revalidate; only the share target
 * opts into the discovery cache.
 *
 * `webDataWiper` is the OS-boundary seam tests replace with a spy; production
 * hands in the real WebView deletion.
 */
class AppSession(
	private val baseUrl: String,
	private val store: TokenStore,
	newClientBuilder: () -> OkHttpClient.Builder,
	private val nativeUserAgent: String,
	private val ioDispatcher: CoroutineDispatcher,
	private val scope: CoroutineScope,
	private val makeWebAuthFlow: (OAuth) -> WebAuthFlow,
	private val webDataWiper: WebDataWiper,
	private val shareArtifacts: ShareArtifacts,
) {
	private val _isLoggedIn = MutableStateFlow(store.isLoggedIn)
	val isLoggedIn: StateFlow<Boolean> = _isLoggedIn.asStateFlow()

	private val sessionCookieJar = SessionCookieJar()

	private val http: OkHttpClient = newClientBuilder()
		.cache(null)
		.cookieJar(sessionCookieJar)
		.build()

	private val serverHost: String = baseUrl.toHttpUrl().host

	fun refreshLoginState() {
		_isLoggedIn.value = store.isLoggedIn
	}

	suspend fun startLogin(): Result<Unit>? =
		authenticate(makeOAuth().makeNativeLoginAuthorizationRequest())

	suspend fun startSignup(): Result<Unit>? =
		authenticate(makeOAuth().makeSignupAuthorizationRequest())

	/** Runs one attempt; the flow answers `null` when the user dismissed the
	 * sign-in page. */
	private suspend fun authenticate(request: AuthorizationRequest): Result<Unit>? {
		val outcome = makeWebAuthFlow(makeOAuth()).start(request)
		refreshLoginState()
		return outcome
	}

	/**
	 * Completes sign-in: validate the callback, exchange the code for tokens, flip
	 * the session to logged-in.
	 *
	 * `redirectUri` must equal the one the authorize request used — the OAuth
	 * server checks it by exact string at token time.
	 */
	suspend fun completeSignIn(
		callbackUrl: String,
		verifier: String,
		expectedState: String,
		redirectUri: String,
	): Result<Unit> {
		val query = queryOf(callbackUrl)
		fun value(name: String): String? = query.queryParameter(name)

		val denial = value("error")
		if (denial != null) return Result.failure(AuthFlowError.Denied(denial))
		val code = value("code") ?: return Result.failure(AuthFlowError.MissingCode())
		if (value("state") != expectedState) return Result.failure(AuthFlowError.StateMismatch())

		return try {
			makeOAuth().exchangeCode(code = code, verifier = verifier, redirectUri = redirectUri)
			refreshLoginState()
			Result.success(Unit)
		} catch (error: Exception) {
			// A catch-all like the iOS original: the token store can fail to seal a
			// token, and that must reach the sign-in screen as a failure, not a crash.
			Result.failure(error)
		}
	}

	suspend fun logout() {
		// The WebView wipe and the network revoke are independent, so they run
		// concurrently; both finish before the logged-out state is published.
		coroutineScope {
			val readerWipe = launch { webDataWiper.wipe(serverHost) }
			makeOAuth().revoke()
			clearSessionCookie()
			shareArtifacts.purge()
			readerWipe.join()
		}
		_isLoggedIn.value = false
	}

	/** Local sign-out used when the session is already invalid (refresh failed).
	 * Stays synchronous so the non-suspending `onSessionExpired` caller is
	 * unaffected; the returned wipe job lets tests await the fire-and-forget
	 * WebView wipe. */
	fun forceLogout(): Job {
		store.clear()
		clearSessionCookie()
		shareArtifacts.purge()
		val readerWipe = scope.launch { webDataWiper.wipe(serverHost) }
		_isLoggedIn.value = false
		return readerWipe
	}

	/** Clears the API session's isolated cookie jar on sign-out so the minted
	 * browser session cookie doesn't linger for the next sign-in in the same
	 * process. The jar is the session's own isolated store (never the WebView's
	 * CookieManager), so clearing it wholesale touches only this app's copy and
	 * needs no knowledge of the server's cookie name. */
	private fun clearSessionCookie() {
		sessionCookieJar.clear()
	}

	/** The callback's query. A callback that is not a URI at all — Android hands
	 * the redirect over as a lenient `Uri`, where iOS's `URL` had already refused
	 * it — has no items, and so reads as one carrying no code. */
	private fun queryOf(callbackUrl: String): HttpUrl {
		val rawQuery = try {
			URI(callbackUrl).rawQuery
		} catch (_: URISyntaxException) {
			null
		}
		return HttpUrl.Builder().scheme("http").host("callback").encodedQuery(rawQuery).build()
	}

	fun makeApi(): ReadplaceApi =
		ReadplaceApi(
			baseUrl = baseUrl,
			client = http,
			store = store,
			oauth = makeOAuth(),
			nativeUserAgent = nativeUserAgent,
			ioDispatcher = ioDispatcher,
		)

	fun makeOAuth(): OAuth = OAuth(baseUrl = baseUrl, store = store, http = http)

	fun makeSloganSource(): SloganSource = initSloganSource(http, baseUrl)
}
