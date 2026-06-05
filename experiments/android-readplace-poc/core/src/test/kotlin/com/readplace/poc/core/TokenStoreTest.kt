package com.readplace.poc.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class TokenStoreTest {
	private fun store() = TokenStore(InMemoryKeyValueStore())

	@Test
	fun `persists and reads back tokens`() {
		val store = store()
		store.save(OAuthTokens("access-1", "refresh-1"))
		assertEquals(OAuthTokens("access-1", "refresh-1"), store.tokens)
		assertTrue(store.isLoggedIn)
	}

	@Test
	fun `a partial token (access without refresh) reads as not logged in`() {
		val backing = InMemoryKeyValueStore()
		backing.putString("oauth.accessToken", "orphan")
		val store = TokenStore(backing)
		assertNull(store.tokens)
		assertFalse(store.isLoggedIn)
	}

	@Test
	fun `updateAccessToken keeps the existing refresh token when none is supplied`() {
		val store = store()
		store.save(OAuthTokens("access-1", "refresh-1"))
		store.updateAccessToken("access-2", refreshToken = null)
		assertEquals(OAuthTokens("access-2", "refresh-1"), store.tokens)
	}

	@Test
	fun `clear removes tokens but leaves the base url`() {
		val store = store()
		store.baseUrl = "https://example.test"
		store.save(OAuthTokens("a", "r"))
		store.clear()
		assertNull(store.tokens)
		assertEquals("https://example.test", store.baseUrl)
	}

	@Test
	fun `base url defaults to the configured server`() {
		assertEquals(AppConfig.DEFAULT_BASE_URL, store().baseUrl)
	}
}
