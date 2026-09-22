package com.readplace.android.core

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

private val JSON_MEDIA_TYPE = "application/json".toMediaType()

sealed class OAuthError(message: String) : Exception(message) {
	class TokenExchangeFailed(val status: Int) : OAuthError("Token exchange failed (HTTP $status).")

	/** A refresh that failed for a reason that is not the current session's fault —
	 * a transport error, a 429/5xx, another 4xx, or a body the parser rejected. The
	 * pair is left intact and the reader is asked to retry, not to sign in again:
	 * signing them out over a blip is the very regression this class exists to
	 * prevent. */
	class RefreshFailed : OAuthError("Could not refresh the session. Please try again.")

	class MalformedResponse : OAuthError("The server returned an unexpected token response.")

	class NoRefreshToken : OAuthError("No refresh token is stored. Please sign in again.")

	/** The session was replaced (logged out, or signed in again) while a token
	 * request was in flight, so its result belongs to a session that no longer
	 * exists. Nonterminal: the caller re-reads the current session rather than
	 * treating it as a sign-out. */
	class SessionChanged : OAuthError("The session changed. Please try again.")
}

/** The parameters needed to launch the in-app authorization flow (shared by Login
 * and Sign up). */
data class AuthorizationRequest(
	val url: String,
	val redirectUri: String,
	val codeVerifier: String,
	val state: String,
)

/**
 * Drives the OAuth 2.0 Authorization Code + PKCE flow against the server,
 * mirroring the browser extension's `initOAuthAuth`.
 *
 * One instance owns the whole process's credentials: the app, the share target
 * and every API consumer share it (built once at the application composition
 * boundary) so a single-flight refresh, a session [generation] fence and the
 * pending-refresh slot are the same for all of them. State transitions — snapshot
 * reads, token writes/clears, generation bumps and pending-slot ownership — are
 * serialized on [mutex] and always released before network I/O, so a held refresh
 * never blocks a concurrent caller from joining it. The refresh itself runs on
 * [refreshScope] (never a caller's coroutine), so cancelling one waiter cannot
 * cancel a refresh another waiter still needs.
 */
class OAuth(
	private val baseUrl: String,
	private val store: TokenStore,
	private val http: OkHttpClient,
	private val nativeUserAgent: String,
	refreshScope: CoroutineScope,
) {
	// The shared refresh runs under a SupervisorJob child of the supplied scope, so a
	// refresh that throws reaches only the callers awaiting it and never cancels the
	// scope the whole process shares. Cancelling the supplied scope still cancels an
	// in-flight refresh, since this is its child.
	private val refreshWork: CoroutineScope =
		CoroutineScope(refreshScope.coroutineContext + SupervisorJob(refreshScope.coroutineContext[Job]))

	private val mutex = Mutex()

	/** Bumped on every clear and every code exchange, so a token request that
	 * started under an older session is fenced out when its result arrives. */
	private var generation = 0L
	private var pending: PendingRefresh? = null
	private var pendingSeq = 0L

	/** The token pair as it stood at one moment, tagged with the session
	 * [generation] it was read under. The authenticated API path captures one for
	 * its bearer and hands it back after a 401, so refresh can tell an old request
	 * from the current session and reuse a winner instead of refreshing again. */
	data class Snapshot(val tokens: OAuthTokens, val generation: Long)

	private class PendingRefresh(val id: Long, val deferred: Deferred<Snapshot>)

	private sealed interface RefreshStep {
		data class Adopt(val snapshot: Snapshot) : RefreshStep

		data class Join(val deferred: Deferred<Snapshot>) : RefreshStep
	}

	/** The custom-scheme redirect used by the auth flow (both Login and Sign up),
	 * which the in-app auth session captures to end the web flow. */
	val nativeRedirectUri: String get() = AppConfig.NATIVE_CALLBACK_URL

	/** Builds the Login `/oauth/authorize` URL: the native custom-scheme callback
	 * plus `screen_hint=login`, so the server shows an unauthenticated user the
	 * sign-in screen (a session already authenticated in the browser's cookie jar
	 * passes straight through to consent, ignoring the hint). */
	fun makeNativeLoginAuthorizationRequest(): AuthorizationRequest =
		makeAuthorizationRequest(screenHint = "login")

	/** Builds the Sign up `/oauth/authorize` URL: the same callback plus
	 * `screen_hint=signup`, so an unauthenticated user lands on the sign-up screen. */
	fun makeSignupAuthorizationRequest(): AuthorizationRequest =
		makeAuthorizationRequest(screenHint = "signup")

	/** The current pair tagged with the current generation, or [OAuthError.NoRefreshToken]
	 * when nothing is stored. Reads through [TokenStore.loadTokens] so an unreadable
	 * store surfaces its own storage error rather than a fabricated missing-token
	 * result. */
	suspend fun snapshot(): Snapshot = mutex.withLock { snapshotLocked() }

	/**
	 * Exchanges the authorization code for tokens and persists them. The OAuth
	 * server checks `redirect_uri` by exact string against the authorize request, so
	 * this must equal the `redirect_uri` that minted the code — the native custom
	 * scheme the auth flow redirects to.
	 *
	 * Advances the generation before the request and detaches any pending refresh,
	 * so a refresh racing this sign-in is fenced out; the minted pair is persisted
	 * only if the session is still the one this exchange started, so a logout or a
	 * later sign-in that lands first is not overwritten.
	 */
	suspend fun exchangeCode(code: String, verifier: String, redirectUri: String): OAuthTokens {
		val started = mutex.withLock {
			generation += 1
			pending = null
			generation
		}
		val form = FormBody.Builder()
			.add("grant_type", "authorization_code")
			.add("code", code)
			.add("redirect_uri", redirectUri)
			.add("client_id", AppConfig.CLIENT_ID)
			.add("code_verifier", verifier)
			.build()
		val answer = send(tokenRequest(form))
		if (answer.status != 200) throw OAuthError.TokenExchangeFailed(answer.status)
		val minted = tokensFrom(answer.body, fallbackRefresh = null)
		mutex.withLock {
			if (generation != started) throw OAuthError.SessionChanged()
			store.save(minted)
		}
		return minted
	}

	/** Uses the stored refresh token to mint a new access token, sharing one
	 * in-flight refresh with any concurrent caller. Persists the result and returns
	 * the new access token, or throws on failure. */
	suspend fun refresh(): AccessToken = refresh(after = snapshot()).tokens.accessToken

	/**
	 * Refreshes the session that [failed] was read under, coalescing concurrent
	 * callers onto one refresh. If the session has since changed generation the
	 * request is [OAuthError.SessionChanged]; if the same generation already holds a
	 * different pair (another caller's refresh already won) that pair is adopted
	 * with no second request; otherwise this joins the in-flight refresh or starts
	 * one on [refreshScope]. Returns the resulting snapshot so the API can confirm
	 * it is still current before retrying.
	 */
	suspend fun refresh(after: Snapshot): Snapshot =
		when (val step = mutex.withLock { planRefresh(after) }) {
			is RefreshStep.Adopt -> step.snapshot
			is RefreshStep.Join -> step.deferred.await()
		}

	/** Best-effort token revocation (logout): captures the stored refresh token,
	 * clears locally first (so a failed or slow network call can never leave the
	 * reader signed in), then sends the revoke request. */
	suspend fun revoke() {
		val stored = mutex.withLock {
			val token = store.tokens?.refreshToken
			clearLocked()
			token
		}
		if (stored != null) {
			val payload = JsonObject(mapOf("token" to JsonPrimitive(stored.raw))).toString()
			val request = Request.Builder()
				.url("$baseUrl/oauth/revoke")
				.post(payload.toByteArray(Charsets.UTF_8).toRequestBody(JSON_MEDIA_TYPE))
				.header("User-Agent", nativeUserAgent)
				.build()
			try {
				send(request)
			} catch (_: IOException) {
			}
		}
	}

	/** Discards the local credentials and advances the generation, so any token
	 * request already in flight is fenced out when it returns. */
	suspend fun clear() = mutex.withLock { clearLocked() }

	/** Clears only if the store still holds [tokens] — the pair a caller decided to
	 * reject. A replacement login that landed first is left in place, so a stale
	 * force-logout cannot erase a newer session. */
	suspend fun clearIfUnchanged(tokens: OAuthTokens?) = mutex.withLock {
		if (store.tokens == tokens) clearLocked()
	}

	private data class Answer(val status: Int, val body: String)

	/** Decides, under [mutex], how [refresh] should proceed for [failed]. Not
	 * suspending: it only reads state and (at most) launches the shared refresh on
	 * [refreshScope], never blocking on I/O while the lock is held. */
	private fun planRefresh(failed: Snapshot): RefreshStep {
		val current = snapshotLocked()
		if (current.generation != failed.generation) throw OAuthError.SessionChanged()
		if (current.tokens != failed.tokens) return RefreshStep.Adopt(current)
		pending?.let { return RefreshStep.Join(it.deferred) }
		val id = ++pendingSeq
		val deferred = refreshWork.async { performRefresh(failed, id) }
		pending = PendingRefresh(id, deferred)
		return RefreshStep.Join(deferred)
	}

	private suspend fun performRefresh(failed: Snapshot, id: Long): Snapshot {
		try {
			val form = FormBody.Builder()
				.add("grant_type", "refresh_token")
				.add("refresh_token", failed.tokens.refreshToken.raw)
				.add("client_id", AppConfig.CLIENT_ID)
				.build()
			// A transport failure is a null answer; every fence and adoption below then
			// runs identically to a response, so the generation is re-checked after the
			// network on the failure path too, not only on success.
			val answer = try {
				send(tokenRequest(form))
			} catch (_: IOException) {
				null
			}
			return mutex.withLock { resolveRefresh(failed, answer) }
		} finally {
			mutex.withLock { if (pending?.id == id) pending = null }
		}
	}

	/**
	 * Resolves a completed refresh under [mutex]; [answer] is null for a transport
	 * failure. Fenced out as [OAuthError.SessionChanged] if the session changed
	 * generation while the request was in flight; adopts the winning pair if another
	 * refresh already replaced it; otherwise only an HTTP 400 carrying a decoded
	 * string `error` of exactly `invalid_grant` discards the pair (the server
	 * rejected this token outright). A transport failure and every other non-200 —
	 * and a malformed 200 — leave the pair intact as a retryable
	 * [OAuthError.RefreshFailed].
	 */
	private fun resolveRefresh(failed: Snapshot, answer: Answer?): Snapshot {
		if (generation != failed.generation) throw OAuthError.SessionChanged()
		val current = snapshotLocked()
		if (current.tokens != failed.tokens) return current
		if (answer == null || answer.status != 200) {
			if (answer != null && answer.status == 400 && decodedInvalidGrant(answer.body)) {
				clearLocked()
				throw OAuthError.NoRefreshToken()
			}
			throw OAuthError.RefreshFailed()
		}
		val minted = tokensFrom(answer.body, fallbackRefresh = failed.tokens.refreshToken)
		store.updateAccessToken(minted.accessToken, minted.refreshToken)
		return snapshotLocked()
	}

	/** Reads the current pair tagged with the current generation. Assumes [mutex] is
	 * held. Throws the store's own error when the store cannot be read, and
	 * [OAuthError.NoRefreshToken] when it is genuinely empty. */
	private fun snapshotLocked(): Snapshot {
		val tokens = store.loadTokens().getOrThrow() ?: throw OAuthError.NoRefreshToken()
		return Snapshot(tokens, generation)
	}

	/** Assumes [mutex] is held. */
	private fun clearLocked() {
		generation += 1
		pending = null
		store.clear()
	}

	private fun makeAuthorizationRequest(screenHint: String): AuthorizationRequest {
		val verifier = Pkce.makeCodeVerifier()
		val state = Pkce.makeState()
		val url = "$baseUrl/oauth/authorize".toHttpUrl().newBuilder()
			.addQueryParameter("client_id", AppConfig.CLIENT_ID)
			.addQueryParameter("redirect_uri", nativeRedirectUri)
			.addQueryParameter("response_type", "code")
			.addQueryParameter("code_challenge", Pkce.challengeFor(verifier))
			.addQueryParameter("code_challenge_method", "S256")
			.addQueryParameter("state", state)
			.addQueryParameter("screen_hint", screenHint)
			.build()
		return AuthorizationRequest(
			url = url.toString(),
			redirectUri = nativeRedirectUri,
			codeVerifier = verifier,
			state = state,
		)
	}

	private fun tokenRequest(form: FormBody): Request =
		Request.Builder()
			.url("$baseUrl/oauth/token")
			.post(form)
			.header("Accept", "application/json")
			.header("User-Agent", nativeUserAgent)
			.build()

	private suspend fun send(request: Request): Answer = withContext(Dispatchers.IO) {
		val response = http.newCall(request).execute()
		try {
			Answer(status = response.code, body = response.body.string())
		} finally {
			response.close()
		}
	}

	private fun tokensFrom(body: String, fallbackRefresh: RefreshToken?): OAuthTokens {
		val parsed = jsonObjectOf(body) ?: throw OAuthError.MalformedResponse()
		val accessToken = stringOf(parsed["access_token"]) ?: throw OAuthError.MalformedResponse()
		val refreshToken = mintedRefreshToken(parsed["refresh_token"])
			?: fallbackRefresh
			?: throw OAuthError.MalformedResponse()
		return OAuthTokens(accessToken = AccessToken(accessToken), refreshToken = refreshToken)
	}

	/** Whether a refusal body is an HTTP 400 `invalid_grant`: a JSON object whose
	 * `error` is the string `invalid_grant`. A non-object body, a non-string `error`,
	 * or any other value is not one, so only an outright rejection discards the pair. */
	private fun decodedInvalidGrant(body: String): Boolean {
		val parsed = jsonObjectOf(body) ?: return false
		return stringOf(parsed["error"]) == "invalid_grant"
	}

	private fun jsonObjectOf(body: String): JsonObject? =
		try {
			Json.parseToJsonElement(body) as? JsonObject
		} catch (_: SerializationException) {
			null
		}

	/** The refresh token the response itself minted, or null when it minted none —
	 * a rotation the server declined, for which the caller falls back to the stored
	 * one. A present token that is not a string is a malformed response, never a
	 * declined rotation. */
	private fun mintedRefreshToken(element: JsonElement?): RefreshToken? {
		if (element == null || element is JsonNull) return null
		return RefreshToken(stringOf(element) ?: throw OAuthError.MalformedResponse())
	}

	private fun stringOf(element: JsonElement?): String? {
		val primitive = element as? JsonPrimitive ?: return null
		return if (primitive.isString) primitive.content else null
	}
}
