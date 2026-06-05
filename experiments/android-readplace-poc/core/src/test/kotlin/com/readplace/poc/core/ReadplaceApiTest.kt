package com.readplace.poc.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.net.URI

class ReadplaceApiTest {
	private fun makeApi(store: TokenStore, http: FakeHttpClient): ReadplaceApi {
		val oauth = OAuthService(store.baseUrl, store, http)
		return ReadplaceApi(store.baseUrl, store, http, oauth)
	}

	private fun saveHtmlAction() = SirenAction("save-html", "/queue/save-html", "POST", "application/json", null)
	private fun saveArticleAction() = SirenAction("save-article", "/queue", "POST", "application/json", null)

	// MARK: - Listing

	@Test
	fun `loadQueue follows the entry-point redirect and preserves the auth header`() {
		val store = TestSupport.loggedInStore(access = "access-1")
		val http = FakeHttpClient()
		http.setHandler { request ->
			when (URI(request.url).path) {
				"/" -> FakeHttpClient.redirect(to = "/queue")
				"/queue" -> FakeHttpClient.json(200, Fixtures.collection(listOf(Fixtures.article(id = "a1"), Fixtures.article(id = "a2")), total = 2))
				else -> FakeHttpClient.json(404, "{}")
			}
		}

		val page = makeApi(store, http).loadQueue()

		assertEquals(listOf("a1", "a2"), page.articles.map { it.id })
		val queueRequest = http.records("/queue").first()
		assertEquals("Bearer access-1", queueRequest.headers["Authorization"])
		assertEquals("application/vnd.siren+json", queueRequest.headers["Accept"])
	}

	@Test
	fun `loadQueue refreshes once and retries on 401`() {
		val store = TestSupport.loggedInStore(access = "stale", refresh = "r1")
		val http = FakeHttpClient()
		var entryAttempts = 0
		http.setHandler { request ->
			when (URI(request.url).path) {
				"/" -> {
					entryAttempts++
					if (entryAttempts == 1) {
						FakeHttpClient.json(401, Fixtures.sirenError("invalid-token", "expired", false))
					} else {
						FakeHttpClient.json(200, Fixtures.collection(listOf(Fixtures.article(id = "fresh"))))
					}
				}
				"/oauth/token" -> FakeHttpClient.json(200, Fixtures.tokenResponse(access = "fresh-access", refresh = "r2"))
				else -> FakeHttpClient.json(404, "{}")
			}
		}

		val page = makeApi(store, http).loadQueue()

		assertEquals(listOf("fresh"), page.articles.map { it.id })
		assertEquals(2, entryAttempts, "should retry exactly once after a refresh")
		assertEquals(1, http.records("/oauth/token").size, "refresh should happen exactly once")
		assertEquals("fresh-access", store.tokens?.accessToken)
		assertEquals("Bearer fresh-access", http.records("/").last().headers["Authorization"])
	}

	@Test
	fun `loadQueue throws unauthorized when the refresh fails and does not loop`() {
		val store = TestSupport.loggedInStore(access = "stale")
		val http = FakeHttpClient()
		var entryAttempts = 0
		http.setHandler { request ->
			when (URI(request.url).path) {
				"/" -> { entryAttempts++; FakeHttpClient.json(401, "{}") }
				"/oauth/token" -> FakeHttpClient.json(400, "{}")
				else -> FakeHttpClient.json(404, "{}")
			}
		}

		val thrown = assertThrows(ApiException::class.java) { makeApi(store, http).loadQueue() }

		assertEquals(ApiError.Unauthorized, thrown.error)
		assertEquals(1, entryAttempts, "must not retry the entry point when refresh fails")
		assertEquals(1, http.records("/oauth/token").size)
	}

	@Test
	fun `loadQueue throws noToken when not signed in`() {
		val store = TokenStore(InMemoryKeyValueStore())
		val thrown = assertThrows(ApiException::class.java) { makeApi(store, FakeHttpClient()).loadQueue() }
		assertEquals(ApiError.NoToken, thrown.error)
	}

	// MARK: - Saving HTML

	@Test
	fun `saveHtml sends the full body on success`() {
		val store = TestSupport.loggedInStore()
		val http = FakeHttpClient()
		http.setHandler { FakeHttpClient.json(201, Fixtures.article(id = "saved", url = "https://example.com/x")) }

		val article = makeApi(store, http).saveHtml(saveHtmlAction(), "https://example.com/x", "<html><body>hi</body></html>", "Captured")

		assertEquals("saved", article.id)
		val body = TestSupport.jsonObject(http.records("/queue/save-html").first().body)
		assertEquals("https://example.com/x", body["url"])
		assertEquals("<html><body>hi</body></html>", body["rawHtml"])
		assertEquals("Captured", body["title"])
	}

	@Test
	fun `saveHtml omits the title when null`() {
		val store = TestSupport.loggedInStore()
		val http = FakeHttpClient()
		http.setHandler { FakeHttpClient.json(201, Fixtures.article(id = "saved")) }

		makeApi(store, http).saveHtml(saveHtmlAction(), "https://example.com/x", "<html></html>", null)

		assertNull(TestSupport.jsonObject(http.records("/queue/save-html").first().body)["title"])
	}

	@Test
	fun `saveHtml falls back to a url-only save when the server offers a fallback action`() {
		val store = TestSupport.loggedInStore()
		val http = FakeHttpClient()
		http.setHandler { request ->
			when (URI(request.url).path) {
				"/queue/save-html" -> FakeHttpClient.json(500, Fixtures.sirenError("html-too-large", "Too big", true))
				"/queue" -> FakeHttpClient.json(201, Fixtures.article(id = "fallback-saved"))
				else -> FakeHttpClient.json(404, "{}")
			}
		}

		val article = makeApi(store, http).saveHtml(saveHtmlAction(), "https://example.com/x", "<huge/>", "T")

		assertEquals("fallback-saved", article.id)
		val fallbackBody = TestSupport.jsonObject(http.records("/queue").first().body)
		assertEquals("https://example.com/x", fallbackBody["url"])
		assertEquals("T", fallbackBody["title"])
		assertNull(fallbackBody["rawHtml"], "fallback must drop the rawHtml payload")
	}

	@Test
	fun `saveHtml throws when the error carries no fallback action`() {
		val store = TestSupport.loggedInStore()
		val http = FakeHttpClient()
		http.setHandler { FakeHttpClient.json(422, Fixtures.sirenError("invalid-save-html", "Invalid", false)) }

		val thrown = assertThrows(ApiException::class.java) {
			makeApi(store, http).saveHtml(saveHtmlAction(), "https://example.com/x", "<html></html>", null)
		}
		val error = thrown.error
		check(error is ApiError.Server)
		assertEquals(422, error.status)
		assertEquals("invalid-save-html", error.code)
	}

	// MARK: - Saving URL only

	@Test
	fun `saveArticle posts the url with the Prefer header`() {
		val store = TestSupport.loggedInStore()
		val http = FakeHttpClient()
		http.setHandler { FakeHttpClient.json(201, Fixtures.article(id = "url-saved")) }

		val article = makeApi(store, http).saveArticle(saveArticleAction(), "https://example.com/x")

		assertEquals("url-saved", article.id)
		val request = http.records("/queue").first()
		assertEquals("return=representation", request.headers["Prefer"])
		assertEquals("https://example.com/x", TestSupport.jsonObject(request.body)["url"])
	}

	// MARK: - Deleting

	@Test
	fun `delete follows the redirect to the refreshed collection and sends the Prefer header`() {
		val store = TestSupport.loggedInStore()
		val http = FakeHttpClient()
		http.setHandler { request ->
			when (URI(request.url).path) {
				"/queue/a1/delete" -> FakeHttpClient.redirect(to = "/queue")
				"/queue" -> FakeHttpClient.json(200, Fixtures.collection(listOf(Fixtures.article(id = "remaining"))))
				else -> FakeHttpClient.json(404, "{}")
			}
		}

		val page = makeApi(store, http).delete("/queue/a1/delete")

		assertEquals(listOf("remaining"), page.articles.map { it.id })
		val deleteRequest = http.records("/queue/a1/delete").first()
		assertEquals("POST", deleteRequest.method)
		assertEquals("return=representation", deleteRequest.headers["Prefer"])
	}

	@Test
	fun `delete throws notFound on a 404`() {
		val store = TestSupport.loggedInStore()
		val http = FakeHttpClient()
		http.setHandler { FakeHttpClient.json(404, "{}") }

		val thrown = assertThrows(ApiException::class.java) { makeApi(store, http).delete("/queue/gone/delete") }
		assertEquals(ApiError.NotFound, thrown.error)
	}
}
