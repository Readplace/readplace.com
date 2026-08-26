package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import javax.crypto.AEADBadTagException

/**
 * A [TokenStorage] holding its values in memory, keyed by the same wire keys the
 * Keystore-backed store writes. Reads of a key listed in [unreadable] fail with the
 * given error — the device condition (a keystore that cannot be decrypted) no plain
 * JVM test could otherwise reproduce.
 */
private class InMemoryTokenStorage(
	private val unreadable: Map<TokenKey, Throwable> = emptyMap(),
) : TokenStorage {
	val stored = mutableMapOf<String, String>()

	override fun readValue(key: TokenKey): Result<String?> {
		val failure = unreadable[key]
		if (failure != null) return Result.failure(failure)
		return Result.success(stored[key.storageKey])
	}

	override fun setValue(key: TokenKey, value: String) {
		stored[key.storageKey] = value
	}

	override fun removeValue(key: TokenKey) {
		stored.remove(key.storageKey)
	}
}

class TokenStoreTest {
	@Test
	fun `a store holding nothing is signed out`() {
		val store = TokenStore(InMemoryTokenStorage())

		assertNull(store.tokens)
		assertFalse(store.isLoggedIn)
	}

	@Test
	fun `a saved pair reads back`() {
		val store = TokenStore(InMemoryTokenStorage())

		store.save(OAuthTokens(AccessToken("a"), RefreshToken("r")))

		assertEquals(OAuthTokens(AccessToken("a"), RefreshToken("r")), store.tokens)
		assertTrue(store.isLoggedIn)
	}

	@Test
	fun `save writes each token under its own key`() {
		val storage = InMemoryTokenStorage()

		TokenStore(storage).save(OAuthTokens(AccessToken("a"), RefreshToken("r")))

		assertEquals(
			mapOf("oauth.accessToken" to "a", "oauth.refreshToken" to "r"),
			storage.stored,
		)
	}

	@Test
	fun `updating the access token alone keeps the stored refresh token`() {
		val store = TokenStore(InMemoryTokenStorage())
		store.save(OAuthTokens(AccessToken("a"), RefreshToken("r")))

		store.updateAccessToken(AccessToken("a2"), null)

		assertEquals(OAuthTokens(AccessToken("a2"), RefreshToken("r")), store.tokens)
	}

	@Test
	fun `updating the access token with a refresh token replaces both`() {
		val store = TokenStore(InMemoryTokenStorage())
		store.save(OAuthTokens(AccessToken("a"), RefreshToken("r")))

		store.updateAccessToken(AccessToken("a2"), RefreshToken("r2"))

		assertEquals(OAuthTokens(AccessToken("a2"), RefreshToken("r2")), store.tokens)
	}

	@Test
	fun `clear removes both tokens`() {
		val storage = InMemoryTokenStorage()
		val store = TokenStore(storage)
		store.save(OAuthTokens(AccessToken("a"), RefreshToken("r")))

		store.clear()

		assertEquals(emptyMap<String, String>(), storage.stored)
		assertNull(store.tokens)
		assertFalse(store.isLoggedIn)
	}

	@Test
	fun `an access token without a refresh token is not a session`() {
		val storage = InMemoryTokenStorage()
		storage.setValue(TokenKey.ACCESS_TOKEN, "only-access")

		assertNull(
			"a missing refresh token cannot be refreshed, so it is not a session",
			TokenStore(storage).tokens,
		)
	}

	@Test
	fun `loadTokens answers the pair when both tokens read`() {
		val store = TokenStore(InMemoryTokenStorage())
		store.save(OAuthTokens(AccessToken("a"), RefreshToken("r")))

		assertEquals(
			Result.success(OAuthTokens(AccessToken("a"), RefreshToken("r"))),
			store.loadTokens(),
		)
	}

	@Test
	fun `loadTokens is signed out, not unreadable, when the store holds nothing`() {
		assertEquals(Result.success(null), TokenStore(InMemoryTokenStorage()).loadTokens())
	}

	@Test
	fun `loadTokens is signed out when only the access token is stored`() {
		val storage = InMemoryTokenStorage()
		storage.setValue(TokenKey.ACCESS_TOKEN, "only-access")

		assertEquals(Result.success(null), TokenStore(storage).loadTokens())
	}

	@Test
	fun `loadTokens surfaces an unreadable access token as the store's own error`() {
		val unreadable = AEADBadTagException("keystore key no longer decrypts")
		val store = TokenStore(InMemoryTokenStorage(mapOf(TokenKey.ACCESS_TOKEN to unreadable)))

		assertEquals(
			"the share sheet names the reason, so the error must arrive unwrapped",
			unreadable,
			store.loadTokens().exceptionOrNull(),
		)
	}

	@Test
	fun `loadTokens surfaces an unreadable refresh token even when the access token reads`() {
		val unreadable = AEADBadTagException("keystore key no longer decrypts")
		val storage = InMemoryTokenStorage(mapOf(TokenKey.REFRESH_TOKEN to unreadable))
		storage.setValue(TokenKey.ACCESS_TOKEN, "a")

		assertEquals(unreadable, TokenStore(storage).loadTokens().exceptionOrNull())
	}

	@Test
	fun `an unreadable store collapses to signed out for the app's own gating`() {
		val unreadable = AEADBadTagException("keystore key no longer decrypts")
		val store = TokenStore(
			InMemoryTokenStorage(
				mapOf(
					TokenKey.ACCESS_TOKEN to unreadable,
					TokenKey.REFRESH_TOKEN to unreadable,
				),
			),
		)

		assertNull(
			"the app re-authenticates rather than reporting a store error",
			store.tokens,
		)
		assertFalse(store.isLoggedIn)
	}

	@Test
	fun `the access token carries the string the app sends as its credential`() {
		assertEquals("a", AccessToken("a").raw)
		assertEquals("r", RefreshToken("r").raw)
	}
}
