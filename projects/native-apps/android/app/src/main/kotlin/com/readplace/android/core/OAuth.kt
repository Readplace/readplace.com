package com.readplace.android.core

import kotlinx.coroutines.Dispatchers
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

	class RefreshFailed : OAuthError("Could not refresh the session. Please sign in again.")

	class MalformedResponse : OAuthError("The server returned an unexpected token response.")

	class NoRefreshToken : OAuthError("No refresh token is stored. Please sign in again.")
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
) {
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
		store.save(minted)
		return minted
	}

	/** Uses the stored refresh token to mint a new access token. Persists the result
	 * and returns the new access token, or throws on failure. */
	suspend fun refresh(): AccessToken {
		val stored = store.tokens?.refreshToken ?: throw OAuthError.NoRefreshToken()
		val form = FormBody.Builder()
			.add("grant_type", "refresh_token")
			.add("refresh_token", stored.raw)
			.add("client_id", AppConfig.CLIENT_ID)
			.build()
		val answer = send(tokenRequest(form))
		if (answer.status != 200) throw OAuthError.RefreshFailed()
		val minted = tokensFrom(answer.body, fallbackRefresh = stored)
		store.updateAccessToken(minted.accessToken, minted.refreshToken)
		return minted.accessToken
	}

	/** Best-effort token revocation (logout), then clears the local tokens. */
	suspend fun revoke() {
		val stored = store.tokens?.refreshToken
		if (stored != null) {
			val payload = JsonObject(mapOf("token" to JsonPrimitive(stored.raw))).toString()
			val request = Request.Builder()
				.url("$baseUrl/oauth/revoke")
				.post(payload.toByteArray(Charsets.UTF_8).toRequestBody(JSON_MEDIA_TYPE))
				.build()
			try {
				send(request)
			} catch (_: IOException) {
			}
		}
		store.clear()
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
