package com.readplace.poc.core

/**
 * A minimal key/value seam so the core stays platform-free. The app backs this
 * with `SharedPreferences`; tests back it with an in-memory map. (A production app
 * would keep tokens in the Android Keystore / EncryptedSharedPreferences.)
 */
interface KeyValueStore {
	fun getString(key: String): String?
	fun putString(key: String, value: String)
	fun remove(key: String)
}

/** OAuth tokens issued by the server's `/oauth/token` endpoint. */
data class OAuthTokens(val accessToken: String, val refreshToken: String)

/**
 * Persists tokens and the active base URL. On Android the launcher app (which signs
 * in) and the share-target Activity (which saves) run in the same app sandbox, so a
 * single backing store is shared between them — no iOS-style App Group is needed.
 */
class TokenStore(private val store: KeyValueStore) {
	private object Key {
		const val ACCESS_TOKEN = "oauth.accessToken"
		const val REFRESH_TOKEN = "oauth.refreshToken"
		const val BASE_URL = "config.baseURL"
	}

	val tokens: OAuthTokens?
		get() {
			val access = store.getString(Key.ACCESS_TOKEN) ?: return null
			val refresh = store.getString(Key.REFRESH_TOKEN) ?: return null
			return OAuthTokens(access, refresh)
		}

	fun save(tokens: OAuthTokens) {
		store.putString(Key.ACCESS_TOKEN, tokens.accessToken)
		store.putString(Key.REFRESH_TOKEN, tokens.refreshToken)
	}

	fun updateAccessToken(accessToken: String, refreshToken: String?) {
		store.putString(Key.ACCESS_TOKEN, accessToken)
		refreshToken?.let { store.putString(Key.REFRESH_TOKEN, it) }
	}

	fun clear() {
		store.remove(Key.ACCESS_TOKEN)
		store.remove(Key.REFRESH_TOKEN)
	}

	var baseUrl: String
		get() = store.getString(Key.BASE_URL) ?: AppConfig.DEFAULT_BASE_URL
		set(value) = store.putString(Key.BASE_URL, value)

	val isLoggedIn: Boolean get() = tokens != null
}
