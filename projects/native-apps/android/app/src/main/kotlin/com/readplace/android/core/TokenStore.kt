package com.readplace.android.core

@JvmInline
value class AccessToken(val raw: String)

@JvmInline
value class RefreshToken(val raw: String)

/** The OAuth token pair persisted for the app and its share target. */
data class OAuthTokens(
	val accessToken: AccessToken,
	val refreshToken: RefreshToken,
)

/** The two persisted token strings, addressed by a stable account key. */
enum class TokenKey(val storageKey: String) {
	ACCESS_TOKEN("oauth.accessToken"),
	REFRESH_TOKEN("oauth.refreshToken"),
}

/**
 * Backing store for the OAuth token strings. Production is Keystore-backed; tests
 * supply their own double.
 *
 * A read tells "no token stored" (success carrying null) apart from "the store
 * could not be read" (failure) — the distinction the share target needs so an
 * unreadable store is never reported as a signed-out account. The failure carries
 * the store's own error unwrapped, so the reason shown to the reader names what
 * actually failed rather than the wrapper it arrived in.
 */
interface TokenStorage {
	fun readValue(key: TokenKey): Result<String?>

	fun setValue(key: TokenKey, value: String)

	fun removeValue(key: TokenKey)
}

/**
 * Persists the OAuth tokens so signing in (the app) and saving (the share target)
 * agree on one identity. The server they target is fixed at build time, not stored
 * here.
 */
class TokenStore(private val storage: TokenStorage) {
	/** The pair, or null when either token is absent OR unreadable: the app's own
	 * session gating re-authenticates either way. A caller that must tell the two
	 * apart reads [loadTokens] instead. */
	val tokens: OAuthTokens?
		get() {
			val access = readOrNull(TokenKey.ACCESS_TOKEN) ?: return null
			val refresh = readOrNull(TokenKey.REFRESH_TOKEN) ?: return null
			return OAuthTokens(AccessToken(access), RefreshToken(refresh))
		}

	val isLoggedIn: Boolean get() = tokens != null

	/** The pair, keeping a genuinely signed-out store (success carrying null) apart
	 * from one that could not be READ (failure carrying the store's error). */
	fun loadTokens(): Result<OAuthTokens?> {
		val access: String = storage.readValue(TokenKey.ACCESS_TOKEN)
			.getOrElse { return Result.failure(it) } ?: return Result.success(null)
		val refresh: String = storage.readValue(TokenKey.REFRESH_TOKEN)
			.getOrElse { return Result.failure(it) } ?: return Result.success(null)
		return Result.success(OAuthTokens(AccessToken(access), RefreshToken(refresh)))
	}

	fun save(tokens: OAuthTokens) {
		storage.setValue(TokenKey.ACCESS_TOKEN, tokens.accessToken.raw)
		storage.setValue(TokenKey.REFRESH_TOKEN, tokens.refreshToken.raw)
	}

	fun updateAccessToken(accessToken: AccessToken, refreshToken: RefreshToken?) {
		storage.setValue(TokenKey.ACCESS_TOKEN, accessToken.raw)
		if (refreshToken != null) storage.setValue(TokenKey.REFRESH_TOKEN, refreshToken.raw)
	}

	fun clear() {
		storage.removeValue(TokenKey.ACCESS_TOKEN)
		storage.removeValue(TokenKey.REFRESH_TOKEN)
	}

	private fun readOrNull(key: TokenKey): String? = storage.readValue(key).getOrNull()
}
