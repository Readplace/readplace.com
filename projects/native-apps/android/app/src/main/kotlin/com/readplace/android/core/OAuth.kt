package com.readplace.android.core

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
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

	class RefreshFailed : OAuthError("Could not refresh the session. Please try again.")

	class MalformedResponse : OAuthError("The server returned an unexpected token response.")

	class NoRefreshToken : OAuthError("No refresh token is stored. Please sign in again.")

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
 */
class OAuth(
	private val baseUrl: String,
	private val store: TokenStore,
	private val http: OkHttpClient,
	private val nativeUserAgent: String,
	private val recovery: NativeRefreshRecovery? = null,
) {
	data class Snapshot(val tokens: OAuthTokens, val generation: Long, val accountEpoch: String = "")

	private val refreshScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
	private var generation = 0L
	private var loginDiagnosticIdentity: String? = null
	private var pending: Deferred<Snapshot>? = null

	@Synchronized
	fun snapshot(): Snapshot? {
		val record = store.authRecords?.read()
		val tokens = if (record == null) store.tokens else record.tokens
		return tokens?.let { Snapshot(it, generation, record?.accountEpoch ?: "") }
	}

	@Synchronized
	fun endSession() {
		generation += 1
		pending = null
		store.clear()
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

	/**
	 * Exchanges the authorization code for tokens and persists them. The OAuth
	 * server checks `redirect_uri` by exact string against the authorize request, so
	 * this must equal the `redirect_uri` that minted the code — the native custom
	 * scheme the auth flow redirects to.
	 */
	suspend fun exchangeCode(code: String, verifier: String, redirectUri: String): OAuthTokens {
		val started = synchronized(this) {
			generation += 1; pending = null
			val identity = loginDiagnosticIdentity ?: java.util.UUID.randomUUID().toString()
			loginDiagnosticIdentity = null
			store.authRecords?.update {
				it.generation++; it.pending = null; it.accountEpoch = java.util.UUID.randomUUID().toString()
				it.diagnosticIdentity = identity; it.diagnosticsPermit = null
				it.generation
			}
		}
		recovery?.record("login_started")
		val form = FormBody.Builder()
			.add("grant_type", "authorization_code")
			.add("code", code)
			.add("redirect_uri", redirectUri)
			.add("client_id", AppConfig.CLIENT_ID)
			.add("code_verifier", verifier)
			.build()
		val request = tokenRequest(form).newBuilder()
		recovery?.requestHeaders()?.forEach { (name, value) -> request.header(name, value) }
		val answer = send(request.build())
		if (answer.status != 200) throw OAuthError.TokenExchangeFailed(answer.status)
		val minted = tokensFrom(answer.body, fallbackRefresh = null)
		val permit = stringOf(jsonObjectOf(answer.body)?.get("diagnostics_permit"))
		val records = store.authRecords
		if (records != null) records.update {
			if (it.generation != started) throw OAuthError.SessionChanged()
			it.access = minted.accessToken.raw; it.refresh = minted.refreshToken.raw; it.bound = false
			if (permit != null) {
				it.diagnosticsPermit = permit
				it.diagnostics = it.diagnostics.map { entry -> if (entry.identity == it.diagnosticIdentity && entry.permit == null) entry.copy(permit = permit) else entry }
			}
		} else store.save(minted)
		recovery?.record("login_completed", "success")
		refreshScope.launch { recovery?.flush() }
		return minted
	}

	suspend fun refresh(after: Snapshot): Snapshot = joinOrStart(after).await()

	@Synchronized
	private fun joinOrStart(failed: Snapshot): Deferred<Snapshot> {
		val current = snapshot() ?: throw OAuthError.NoRefreshToken()
		if (current.generation != failed.generation || current.accountEpoch != failed.accountEpoch) throw OAuthError.SessionChanged()
		if (current.tokens != failed.tokens) return CompletableDeferred(current)
		pending?.takeIf { it.isActive }?.let { return it }
		return refreshScope.async { performRefresh(failed) }.also { pending = it }
	}

	private suspend fun performRefresh(failed: Snapshot): Snapshot {
		val restored = recovery?.refresh(failed.tokens)
		if (restored != null) {
			val result = synchronized(this) {
				if (generation != failed.generation) throw OAuthError.SessionChanged()
				val current = snapshot() ?: throw OAuthError.NoRefreshToken()
				if (current.accountEpoch != failed.accountEpoch) throw OAuthError.SessionChanged()
				current
			}
			refreshScope.launch { recovery?.flush() }
			return result
		}
		val form = FormBody.Builder()
			.add("grant_type", "refresh_token")
			.add("refresh_token", failed.tokens.refreshToken.raw)
			.add("client_id", AppConfig.CLIENT_ID)
			.build()
		val answer = try {
			send(tokenRequest(form))
		} catch (_: IOException) {
			null
		}
		return settle(failed, answer)
	}

	@Synchronized
	private fun settle(failed: Snapshot, answer: Answer?): Snapshot {
		if (generation != failed.generation) throw OAuthError.SessionChanged()
		val current = snapshot() ?: throw OAuthError.NoRefreshToken()
		if (current.accountEpoch != failed.accountEpoch) throw OAuthError.SessionChanged()
		if (current.tokens != failed.tokens) return current
		if (answer == null) throw OAuthError.RefreshFailed()
		if (answer.status != 200) throw refusalOf(answer, failed)
		val minted = tokensFrom(answer.body, fallbackRefresh = failed.tokens.refreshToken)
		val records = store.authRecords
		if (records == null) store.save(minted) else records.update {
			if (it.tokens != failed.tokens || it.accountEpoch != failed.accountEpoch) throw OAuthError.SessionChanged()
			it.generation++; it.access = minted.accessToken.raw; it.refresh = minted.refreshToken.raw
		}
		return Snapshot(minted, generation, failed.accountEpoch)
	}

	private fun refusalOf(answer: Answer, failed: Snapshot): OAuthError {
		if (answer.status != 400 || stringOf(jsonObjectOf(answer.body)?.get("error")) != "invalid_grant") {
			return OAuthError.RefreshFailed()
		}
		val records = store.authRecords
		if (records == null) endSession() else {
			records.update {
				if (it.tokens != failed.tokens || it.accountEpoch != failed.accountEpoch) throw OAuthError.SessionChanged()
				it.generation++; it.access = null; it.refresh = null; it.pending = null; it.bound = false
			}
			generation++; pending = null
		}
		return OAuthError.NoRefreshToken()
	}

	suspend fun revoke() {
		val previous = store.authRecords?.read()
		val stored = store.tokens?.refreshToken
		endSession()
		recovery?.record("logout_started", reason = "user_requested")
		if (recovery != null && previous != null && (previous.bound || previous.pending != null)) {
			runCatching { recovery?.revoke(previous) }
			recovery.record("logout_completed")
			refreshScope.launch { recovery?.flush() }
			return
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
		recovery?.record("logout_completed")
		refreshScope.launch { recovery?.flush() }
	}

	fun recordAuthEvent(event: String, outcome: String? = null, reason: String? = null) {
		if (event == "login_started") synchronized(this) {
			val identity = java.util.UUID.randomUUID().toString()
			runCatching { store.authRecords?.update { state ->
				state.diagnostics = state.diagnostics.map {
					if (it.identity == state.diagnosticIdentity && it.permit == null && it.event.event == "login_prompt_shown") it.copy(identity = identity) else it
				}
				state.diagnosticIdentity = identity; state.diagnosticsPermit = null
			} }
			loginDiagnosticIdentity = identity
		}
		recovery?.record(event, outcome, reason)
		refreshScope.launch { recovery?.flush() }
	}

	private data class Answer(val status: Int, val body: String)

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
		val accessToken = nonEmptyStringOf(parsed["access_token"]) ?: throw OAuthError.MalformedResponse()
		val refreshToken = mintedRefreshToken(parsed["refresh_token"])
			?: fallbackRefresh?.takeIf { it.raw.isNotEmpty() }
			?: throw OAuthError.MalformedResponse()
		return OAuthTokens(accessToken = AccessToken(accessToken), refreshToken = refreshToken)
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
		return RefreshToken(nonEmptyStringOf(element) ?: throw OAuthError.MalformedResponse())
	}

	private fun nonEmptyStringOf(element: JsonElement?): String? =
		stringOf(element)?.takeIf { it.isNotEmpty() }

	private fun stringOf(element: JsonElement?): String? {
		val primitive = element as? JsonPrimitive ?: return null
		return if (primitive.isString) primitive.content else null
	}
}
