package com.readplace.poc.core

import com.readplace.poc.core.http.HttpRequest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.net.URI
import java.net.URLDecoder

class OAuthServiceTest {
	private fun service(store: TokenStore, http: FakeHttpClient) = OAuthService(store.baseUrl, store, http)

	private fun queryParams(url: String): Map<String, String> =
		URI(url).rawQuery.split("&").associate { pair ->
			val (k, v) = pair.split("=", limit = 2)
			URLDecoder.decode(k, "UTF-8") to URLDecoder.decode(v, "UTF-8")
		}

	@Test
	fun `authorization request carries the PKCE and client parameters`() {
		val store = TestSupport.loggedInStore()
		val request = service(store, FakeHttpClient()).makeAuthorizationRequest()

		val params = queryParams(request.url)
		assertEquals(AppConfig.CLIENT_ID, params["client_id"])
		assertEquals("https://readplace.com/oauth/callback", params["redirect_uri"])
		assertEquals("code", params["response_type"])
		assertEquals("S256", params["code_challenge_method"])
		assertEquals(request.state, params["state"])
		assertEquals(Pkce.challenge(request.codeVerifier), params["code_challenge"])
	}

	@Test
	fun `exchangeCode posts the code and persists the returned tokens`() {
		val store = TokenStore(InMemoryKeyValueStore())
		val http = FakeHttpClient()
		http.setHandler { FakeHttpClient.json(200, Fixtures.tokenResponse(access = "a-new", refresh = "r-new")) }

		val tokens = service(store, http).exchangeCode(code = "the-code", verifier = "the-verifier")

		assertEquals(OAuthTokens("a-new", "r-new"), tokens)
		assertEquals(OAuthTokens("a-new", "r-new"), store.tokens)
		val body = TestSupport.formFields(http.records("/oauth/token").first().body)
		assertEquals("authorization_code", body["grant_type"])
		assertEquals("the-code", body["code"])
		assertEquals("the-verifier", body["code_verifier"])
		assertEquals(AppConfig.CLIENT_ID, body["client_id"])
	}

	@Test
	fun `exchangeCode throws when the server rejects the code`() {
		val store = TokenStore(InMemoryKeyValueStore())
		val http = FakeHttpClient()
		http.setHandler { FakeHttpClient.json(400, "{}") }

		val thrown = assertThrows(OAuthException::class.java) {
			service(store, http).exchangeCode(code = "bad", verifier = "v")
		}
		assertTrue(thrown.error is OAuthError.TokenExchangeFailed)
		assertNull(store.tokens)
	}

	@Test
	fun `refresh keeps the existing refresh token when the server omits one`() {
		val store = TestSupport.loggedInStore(access = "stale", refresh = "r1")
		val http = FakeHttpClient()
		http.setHandler { FakeHttpClient.json(200, Fixtures.tokenResponse(access = "fresh", refresh = null)) }

		val access = service(store, http).refresh()

		assertEquals("fresh", access)
		assertEquals(OAuthTokens("fresh", "r1"), store.tokens)
	}

	@Test
	fun `refresh replaces the refresh token when the server rotates it`() {
		val store = TestSupport.loggedInStore(access = "stale", refresh = "r1")
		val http = FakeHttpClient()
		http.setHandler { FakeHttpClient.json(200, Fixtures.tokenResponse(access = "fresh", refresh = "r2")) }

		service(store, http).refresh()

		assertEquals(OAuthTokens("fresh", "r2"), store.tokens)
	}

	@Test
	fun `refresh throws when no refresh token is stored`() {
		val store = TokenStore(InMemoryKeyValueStore())
		val thrown = assertThrows(OAuthException::class.java) { service(store, FakeHttpClient()).refresh() }
		assertEquals(OAuthError.NoRefreshToken, thrown.error)
	}

	@Test
	fun `revoke posts the refresh token then clears local tokens`() {
		val store = TestSupport.loggedInStore(refresh = "r-revoke")
		val http = FakeHttpClient()
		http.setHandler { FakeHttpClient.json(200, "{}") }

		service(store, http).revoke()

		assertNull(store.tokens)
		val revoke: HttpRequest = http.records("/oauth/revoke").first()
		assertEquals("POST", revoke.method)
		assertTrue(revoke.body!!.decodeToString().contains("r-revoke"))
	}

	@Test
	fun `revoke clears local tokens even if the network call fails`() {
		val store = TestSupport.loggedInStore()
		val http = FakeHttpClient()
		http.setHandler { throw RuntimeException("offline") }

		service(store, http).revoke()

		assertNull(store.tokens)
	}
}
