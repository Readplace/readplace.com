package com.readplace.poc.core

import com.readplace.poc.core.http.HttpClient
import com.readplace.poc.core.http.HttpRequest
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder

/** Why an OAuth step failed, with a user-facing message. */
sealed class OAuthError(val message: String) {
	data class TokenExchangeFailed(val status: Int) : OAuthError("Token exchange failed (HTTP $status).")
	data object RefreshFailed : OAuthError("Could not refresh the session. Please sign in again.")
	data object MalformedResponse : OAuthError("The server returned an unexpected token response.")
	data object NoRefreshToken : OAuthError("No refresh token is stored. Please sign in again.")
}

class OAuthException(val error: OAuthError) : Exception(error.message)

/** The parameters needed to launch the in-app authorization web flow. */
data class AuthorizationRequest(
	val url: String,
	val redirectUri: String,
	val codeVerifier: String,
	val state: String,
)

@Serializable
private data class TokenResponse(val access_token: String? = null, val refresh_token: String? = null)

/**
 * Drives the OAuth 2.0 Authorization Code + PKCE flow against the server, mirroring
 * the browser extension's `initOAuthAuth` and the iOS POC's `OAuthService`.
 */
class OAuthService(
	val baseUrl: String,
	private val store: TokenStore,
	private val http: HttpClient,
) {
	val redirectUri: String get() = "$baseUrl${AppConfig.CALLBACK_PATH}"
	private val tokenEndpoint get() = "$baseUrl/oauth/token"
	private val authorizeEndpoint get() = "$baseUrl/oauth/authorize"
	private val revokeEndpoint get() = "$baseUrl/oauth/revoke"

	/** Builds the `/oauth/authorize` URL with a fresh PKCE verifier + state. */
	fun makeAuthorizationRequest(): AuthorizationRequest {
		val verifier = Pkce.makeCodeVerifier()
		val state = Pkce.makeState()
		val query = formEncode(
			mapOf(
				"client_id" to AppConfig.CLIENT_ID,
				"redirect_uri" to redirectUri,
				"response_type" to "code",
				"code_challenge" to Pkce.challenge(verifier),
				"code_challenge_method" to "S256",
				"state" to state,
			),
		)
		return AuthorizationRequest("$authorizeEndpoint?$query", redirectUri, verifier, state)
	}

	/** Exchanges the authorization code for tokens and persists them. */
	fun exchangeCode(code: String, verifier: String): OAuthTokens {
		val body = formEncode(
			mapOf(
				"grant_type" to "authorization_code",
				"code" to code,
				"redirect_uri" to redirectUri,
				"client_id" to AppConfig.CLIENT_ID,
				"code_verifier" to verifier,
			),
		)
		val response = http.execute(tokenRequest(body))
		if (response.status != 200) throw OAuthException(OAuthError.TokenExchangeFailed(response.status))
		val tokens = parseTokens(response.bodyText, fallbackRefresh = null)
		store.save(tokens)
		return tokens
	}

	/**
	 * Uses the stored refresh token to mint a new access token. Persists the result
	 * and returns the new access token, or throws on failure.
	 */
	fun refresh(): String {
		val refresh = store.tokens?.refreshToken ?: throw OAuthException(OAuthError.NoRefreshToken)
		val body = formEncode(
			mapOf(
				"grant_type" to "refresh_token",
				"refresh_token" to refresh,
				"client_id" to AppConfig.CLIENT_ID,
			),
		)
		val response = http.execute(tokenRequest(body))
		if (response.status != 200) throw OAuthException(OAuthError.RefreshFailed)
		val tokens = parseTokens(response.bodyText, fallbackRefresh = refresh)
		store.updateAccessToken(tokens.accessToken, tokens.refreshToken)
		return tokens.accessToken
	}

	/** Best-effort token revocation (logout), then clears local tokens. */
	fun revoke() {
		store.tokens?.refreshToken?.let { refresh ->
			runCatching {
				http.execute(
					HttpRequest(
						url = revokeEndpoint,
						method = "POST",
						headers = mapOf("Content-Type" to "application/json"),
						body = Json.encodeToString(JsonObject.serializer(), buildJsonObject { put("token", refresh) }).toByteArray(),
					),
				)
			}
		}
		store.clear()
	}

	// MARK: - Helpers

	private fun tokenRequest(body: String): HttpRequest =
		HttpRequest(
			url = tokenEndpoint,
			method = "POST",
			headers = mapOf(
				"Content-Type" to "application/x-www-form-urlencoded",
				"Accept" to "application/json",
			),
			body = body.toByteArray(),
		)

	private fun parseTokens(body: String, fallbackRefresh: String?): OAuthTokens {
		val parsed = runCatching { SirenJson.decodeFromString<TokenResponse>(body) }.getOrNull()
		val access = parsed?.access_token ?: throw OAuthException(OAuthError.MalformedResponse)
		val refresh = parsed.refresh_token ?: fallbackRefresh ?: throw OAuthException(OAuthError.MalformedResponse)
		return OAuthTokens(access, refresh)
	}

	private fun formEncode(params: Map<String, String>): String =
		params.entries.joinToString("&") { (key, value) ->
			"${URLEncoder.encode(key, "UTF-8")}=${URLEncoder.encode(value, "UTF-8")}"
		}
}
